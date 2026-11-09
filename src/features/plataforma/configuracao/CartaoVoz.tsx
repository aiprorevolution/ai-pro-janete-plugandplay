import type { KeyboardEvent } from "react";

import { Botao, cx } from "@/components/aipro";
import { LogoTile, s as lista } from "@/features/onboarding/lista";
import { IC } from "@/features/onboarding/lista/dados";
import type { ModoVoz } from "@/features/servidor/vozes-tipos";

import { NOME_SITUACAO_C, PROVEDOR_VOZ, artigoNome } from "./dados";
import { c } from "./estilos";
import { quandoValidada, type LeituraV } from "./leitura";
import { AvisoCartao, Ic, LinhaDl, LinhaEstado } from "./pecas";
import { OPCOES_MODO_VOZ, TEXTO_AVISO_VOZ } from "./textos";

interface Props {
  admin: boolean;
  voz: LeituraV;
  agora: Date;
  /** Uma conferência em andamento (o "Conferir tudo"): tudo do cartão fica desligado. */
  bloqueado: boolean;
  realce: "flash" | "nasce" | null;
  oculto: boolean;
  aoConectar: () => void;
  /** Abre a lista de vozes da conta (o fluxo "vozes"). */
  aoEscolherVoz?: (() => void) | undefined;
  /** Grava o modo escolhido (salva ao escolher, sem botão de salvar). */
  aoMudarModo?: ((modo: ModoVoz) => void) | undefined;
  /** O modo que está sendo gravado agora: ele aparece marcado e o grupo não aceita outra escolha. */
  salvandoModo?: ModoVoz | null | undefined;
  /** Remove a chave da ElevenLabs (a Janete responde em texto; a escolha da voz fica guardada). */
  aoRemover?: (() => void) | undefined;
  removendo?: boolean | undefined;
}

/**
 * 4 · Voz da Janete: "Não configurada" com "Conectar a ElevenLabs", ou a chave terminada em XXXX, a
 * última validação e a voz escolhida; o grupo "Responder em áudio" (3 opções que salvam ao
 * escolher); o motivo de a resposta sair em texto; e Escolher a voz, Remover e Trocar a chave.
 * Entra no fio da Saúde como "Fala" (P13), sem nunca parar a Janete: a falha da fala vira texto.
 */
export function CartaoVoz({
  admin,
  voz,
  agora,
  bloqueado,
  realce,
  oculto,
  aoConectar,
  aoEscolherVoz,
  aoMudarModo,
  salvandoModo = null,
  aoRemover,
  removendo,
}: Props) {
  const comChave = voz.conhecida && !!voz.chave;
  const ativa = voz.chave?.status === "ativa";
  const titulo = !voz.conhecida
    ? "Voz da Janete"
    : comChave
      ? ativa
        ? `Conectada, com ${artigoNome(PROVEDOR_VOZ)}`
        : `Com ${artigoNome(PROVEDOR_VOZ)}`
      : "Não configurada";
  // a situação da chave; com ela ativa, o que ainda falta para a Janete falar
  const estado = !voz.conhecida
    ? "Só quem administra vê"
    : !comChave
      ? "Sem chave"
      : !ativa
        ? NOME_SITUACAO_C[voz.chave!.status]
        : voz.aviso === "voz_nao_encontrada"
          ? "Voz não encontrada"
          : voz.aviso === "sem_voz"
            ? "Sem voz escolhida"
            : NOME_SITUACAO_C.ativa;
  const ocupado = bloqueado || !!removendo;
  // o modo que aparece marcado: o que está sendo gravado, ou o salvo
  const modoTela = salvandoModo ?? voz.modo;

  const escolherModo = (m: ModoVoz) => {
    if (ocupado || salvandoModo || m === voz.modo || !aoMudarModo) return;
    aoMudarModo(m);
  };
  // as setas só andam com o foco: escolher é Espaço, Enter ou clique, para cada seta não virar uma
  // gravação (o mesmo cuidado da lista de vozes do onboarding, P17)
  const tecla = (i: number) => (ev: KeyboardEvent<HTMLButtonElement>) => {
    const n = OPCOES_MODO_VOZ.length;
    let j: number;
    if (ev.key === "ArrowDown" || ev.key === "ArrowRight") j = (i + 1) % n;
    else if (ev.key === "ArrowUp" || ev.key === "ArrowLeft") j = (i - 1 + n) % n;
    else if (ev.key === "Home") j = 0;
    else if (ev.key === "End") j = n - 1;
    else return;
    ev.preventDefault();
    document.getElementById(`cfg-modo-voz-${OPCOES_MODO_VOZ[j]!.modo}`)?.focus({ preventScroll: true });
  };

  return (
    <section
      id="cfg-card-voz"
      className={cx(c.cfCartao, c.cfBlk, oculto && c.cfOculto)}
      data-realce={realce ?? undefined}
      aria-labelledby="cfg-m-voz cfg-h-voz"
    >
      <header className={c.cfBlkCab}>
        {comChave ? (
          <LogoTile logo={PROVEDOR_VOZ.logo} alt={PROVEDOR_VOZ.nome} />
        ) : (
          <span className={lista.linhaIcone} aria-hidden="true">
            <Ic d={IC.microfone} tamanho="g" />
          </span>
        )}
        <div className={c.cfBlkTitulo}>
          <p className={c.cfMeta} id="cfg-m-voz">
            Voz da Janete
          </p>
          <h2 id="cfg-h-voz" tabIndex={-1} className={c.cfBlkH}>
            {titulo}
          </h2>
        </div>
        <LinhaEstado
          tom={!voz.conhecida ? undefined : voz.ok ? "ok" : "atencao"}
          icone={!voz.conhecida ? IC.cadeado : voz.ok ? IC.ok : IC.triangulo}
        >
          {estado}
        </LinhaEstado>
      </header>

      {!voz.conhecida && <p className={c.cfApoio}>A chave de voz fica com quem administra a conta.</p>}

      {voz.conhecida && !comChave && (
        <div className={c.cfVazioEsc}>
          {/* o que falta: a chave da ElevenLabs (o microfone já está no cabeçalho) */}
          <LogoTile logo={PROVEDOR_VOZ.logo} alt={PROVEDOR_VOZ.nome} />
          <div className={c.cfVazioTxt}>
            <h3 className={c.cfHCartao}>A Janete ainda não tem voz</h3>
            <p className={c.cfApoio}>
              Com a ElevenLabs, a Janete responde por áudio e, sem outra chave que transcreva, também escuta os áudios dos
              leads. Cole uma chave para deixar tudo pronto.
            </p>
            {admin ? (
              <div className={c.cfVazioAcoes}>
                <Botao id="cfg-conectar-voz" disabled={bloqueado} onClick={aoConectar} iconeDepois={<Ic d={IC.seta} />}>
                  Conectar a ElevenLabs
                </Botao>
              </div>
            ) : (
              <p className={c.cfMeta}>Só quem administra a conta conecta a chave.</p>
            )}
          </div>
        </div>
      )}

      {comChave && (
        <>
          {admin && voz.aviso && (
            <AvisoCartao tom="atencao" icone={IC.triangulo}>
              <span>{TEXTO_AVISO_VOZ[voz.aviso]}</span>
            </AvisoCartao>
          )}
          <dl className={c.cfBlkDl}>
            {admin && (
              <LinhaDl rotulo="Chave">
                <Ic d={IC.cadeado} tamanho="p" />
                <span>
                  terminada em <span className={c.cfMono}>{voz.chave!.ultimos4}</span>
                  {/* a mesma chave da ElevenLabs nos dois cartões (E2): cada um guarda a sua */}
                  {voz.mesmaChaveDaEscuta && " · Mesma chave da Escuta de áudio"}
                </span>
              </LinhaDl>
            )}
            {voz.chave!.validada_em && (
              <LinhaDl rotulo="Última validação">{quandoValidada(voz.chave!.validada_em, agora)}</LinhaDl>
            )}
            <LinhaDl rotulo="Voz">{voz.voz ? voz.voz.nome : "Nenhuma escolhida"}</LinhaDl>
          </dl>
          {admin && aoMudarModo && (
            <div className={c.cfModoVoz}>
              <p className={c.cfCampoRotulo} id="cfg-rot-modo-voz">
                Responder em áudio
              </p>
              <div
                className={c.cfModoVozOpcoes}
                role="radiogroup"
                aria-labelledby="cfg-rot-modo-voz"
                aria-busy={salvandoModo ? true : undefined}
              >
                {OPCOES_MODO_VOZ.map((o, i) => {
                  const marcado = o.modo === modoTela;
                  return (
                    <button
                      key={o.modo}
                      type="button"
                      role="radio"
                      id={`cfg-modo-voz-${o.modo}`}
                      className={c.cfModoVozOpcao}
                      aria-checked={marcado}
                      // gravando: aria-disabled (e não disabled) para o foco não cair no corpo da página
                      aria-disabled={(!ocupado && !!salvandoModo) || undefined}
                      disabled={ocupado}
                      tabIndex={marcado ? 0 : -1}
                      onClick={() => escolherModo(o.modo)}
                      onKeyDown={tecla(i)}
                    >
                      <span className={c.cfModoVozRadio} aria-hidden="true" />
                      <span>{o.rotulo}</span>
                      {salvandoModo === o.modo && <span className={c.cfModoVozSalvando}>Salvando…</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {admin && (
            <div className={c.cfBlkPe}>
              {aoRemover && (
                <Botao
                  id="cfg-remover-voz"
                  variante="perigo"
                  className={cx(c.cfBtnC, c.cfPerigoLeve)}
                  carregando={removendo}
                  disabled={ocupado}
                  onClick={aoRemover}
                >
                  Remover a chave de voz
                </Botao>
              )}
              <div className={c.cfDir}>
                {aoEscolherVoz && (
                  <Botao
                    id="cfg-escolher-voz"
                    variante={voz.voz && voz.aviso !== "voz_nao_encontrada" ? "contorno" : "principal"}
                    disabled={ocupado}
                    onClick={aoEscolherVoz}
                  >
                    {voz.voz ? "Trocar a voz" : "Escolher a voz"}
                  </Botao>
                )}
                <Botao id="cfg-trocar-voz" variante="contorno" disabled={ocupado} onClick={aoConectar}>
                  Trocar a chave de voz
                </Botao>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
