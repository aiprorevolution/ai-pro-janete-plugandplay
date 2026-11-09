import { Botao, Selo, cx } from "@/components/aipro";
import { s as lista } from "@/features/onboarding/lista";
import { IC } from "@/features/onboarding/lista/dados";

import { NOME_SITUACAO_C, artigoNome, deNome, maiuscula } from "./dados";
import { c } from "./estilos";
import { AVISO_ANTHROPIC_SEM_ESCUTA, avisaSemEscuta, quandoValidada, type LeituraC, type LeituraE } from "./leitura";
import { AvisoCartao, Ic, LinhaDl, LinhaEstado, LogoMoeda } from "./pecas";
import { textoErroChave } from "./textos";

interface Props {
  admin: boolean;
  cer: LeituraC;
  /** A escuta: com a Anthropic e sem escuta nenhuma, o cartão avisa que a Janete não entende áudio. */
  esc: LeituraE;
  agora: Date;
  testando: boolean;
  /** Outra conferência em andamento (o "Conferir tudo"): trocar fica desligado. */
  bloqueado: boolean;
  /** A resposta do provedor no último teste que falhou (some quando a chave volta). */
  erroTeste: string | null;
  realce: "flash" | "nasce" | null;
  oculto: boolean;
  /** O "Simular" só existe na demo (o modo exemplo). */
  demo?: boolean | undefined;
  simular: boolean;
  aoSimular: (v: boolean) => void;
  aoTestarChave: () => void;
  aoTrocarChave: () => void;
  aoTrocarModelo: () => void;
  aoTrocarMotor: () => void;
}

/** A resposta do provedor, como o protótipo mostra sob o aviso (só o admin vê). */
function respostaProvedor(cer: LeituraC): string {
  const nome = cer.motor?.nome ?? "provedor";
  // o ultimo_erro guarda um código curto (ia_chaves): vira frase, nunca aparece cru
  const texto = textoErroChave(cer.chave?.ultimo_erro, cer.situacao);
  return texto ? `Resposta da ${nome}: ${texto}` : "";
}

/**
 * 2 · Cérebro: o provedor, o modelo com o perfil e o preço, "chave terminada em TSTE" e a última
 * validação. Trocar o modelo, a chave ou o provedor reabre os cartões do onboarding. A atendente
 * vê a situação, sem chave, sem preço e sem botões.
 */
export function CartaoCerebro(props: Props) {
  const { admin, cer, agora, testando, bloqueado, realce, oculto } = props;
  const motor = cer.motor;
  const removida = cer.situacao === "removida";
  const temAviso = cer.conhecida && (cer.situacao === "sem_credito" || cer.situacao === "invalida");
  const estado = !cer.conhecida ? "Só quem administra vê" : testando ? "Testando a chave…" : NOME_SITUACAO_C[cer.situacao];
  const tom = !cer.conhecida ? undefined : testando ? "atencao" : cer.ok ? "ok" : "erro";
  const icone = !cer.conhecida ? IC.cadeado : testando ? IC.pendente : cer.ok ? IC.ok : IC.alerta;

  return (
    <section
      id="cfg-card-cerebro"
      className={cx(c.cfCartao, c.cfBlk, oculto && c.cfOculto)}
      data-realce={realce ?? undefined}
      aria-labelledby="cfg-m-cerebro cfg-h-cerebro"
    >
      <header className={c.cfBlkCab}>
        {motor ? (
          <LogoMoeda logo={motor.logo} gira={testando} />
        ) : (
          <span className={lista.linhaIcone} aria-hidden="true">
            <Ic d={IC.cadeado} tamanho="g" />
          </span>
        )}
        <div className={c.cfBlkTitulo}>
          <p className={c.cfMeta} id="cfg-m-cerebro">
            Cérebro
          </p>
          <h2 id="cfg-h-cerebro" tabIndex={-1} className={c.cfBlkH}>
            {!cer.conhecida ? "O cérebro da Janete" : removida ? "Sem chave de IA" : cer.nomeModelo}
          </h2>
        </div>
        <LinhaEstado tom={tom} icone={icone} girando={testando} vivo>
          {estado}
        </LinhaEstado>
      </header>

      {!cer.conhecida && (
        <p className={c.cfApoio}>A chave, o provedor e o modelo ficam com quem administra a conta.</p>
      )}

      {temAviso && (
        <AvisoCartao tom="erro" icone={IC.alerta} titulo="A Janete parou de responder." papel="alert">
          <span>
            {admin
              ? cer.situacao === "sem_credito"
                ? `A chave ${deNome(motor)} ficou sem crédito. Coloque crédito na sua conta ${deNome(motor)} e teste de novo, ou cole outra chave.`
                : `${maiuscula(artigoNome(motor))} recusou a chave. Cole uma chave nova e valide.`
              : "Avise quem administra a conta: só essa pessoa troca a chave."}
          </span>
          {admin && <span className={c.cfAvisoMeta}>{props.erroTeste ?? respostaProvedor(cer)}</span>}
        </AvisoCartao>
      )}

      {avisaSemEscuta(cer, props.esc) && (
        <AvisoCartao tom="info" icone={IC.microfone}>
          <span>{AVISO_ANTHROPIC_SEM_ESCUTA}</span>
        </AvisoCartao>
      )}

      {cer.conhecida && removida && (
        <div className={c.cfVazioEsc}>
          <span className={lista.linhaIcone} aria-hidden="true">
            <Ic d={IC.cadeado} tamanho="g" />
          </span>
          <div className={c.cfVazioTxt}>
            <h3 className={c.cfHCartao}>A Janete está sem chave de IA</h3>
            <p className={c.cfApoio}>
              A chave foi removida. As mensagens chegam, mas ninguém responde até uma chave nova ser validada.
            </p>
            {admin ? (
              <div className={c.cfVazioAcoes}>
                <Botao id="cfg-conectar-chave" disabled={bloqueado} onClick={props.aoTrocarChave} iconeDepois={<Ic d={IC.seta} />}>
                  Conectar uma chave
                </Botao>
              </div>
            ) : (
              <p className={c.cfMeta}>Avise quem administra a conta: só essa pessoa conecta a chave.</p>
            )}
          </div>
        </div>
      )}

      {cer.conhecida && !removida && (
        <dl className={c.cfBlkDl}>
          <LinhaDl rotulo="Provedor">{motor?.nome ?? cer.chave?.provedor ?? ""}</LinhaDl>
          {cer.modelo && (
            <LinhaDl rotulo={admin ? "Perfil e preço" : "Perfil"}>
              <Selo variante="fato" compacto>
                {cer.modelo.perfil}
              </Selo>
              {admin && cer.preco && <span className={c.cfDlPreco}>{cer.preco}</span>}
            </LinhaDl>
          )}
          {admin && cer.chave && (
            <LinhaDl rotulo="Chave">
              <Ic d={IC.cadeado} tamanho="p" />
              <span>
                terminada em <span className={c.cfMono}>{cer.chave.ultimos4}</span>
              </span>
            </LinhaDl>
          )}
          {cer.chave?.validada_em && <LinhaDl rotulo="Última validação">{quandoValidada(cer.chave.validada_em, agora)}</LinhaDl>}
        </dl>
      )}

      {admin && (
        <div className={c.cfBlkPe}>
          {cer.situacao === "sem_credito" && (
            <>
              <Botao id="cfg-testar-chave" carregando={testando} onClick={props.aoTestarChave}>
                {testando ? "Testando…" : "Testar a chave de novo"}
              </Botao>
              <Botao variante="contorno" disabled={testando || bloqueado} onClick={props.aoTrocarChave}>
                Colar outra chave
              </Botao>
              {props.demo && <label className={c.cfSim} htmlFor="cfg-sim-c">
                <input
                  id="cfg-sim-c"
                  type="checkbox"
                  checked={props.simular}
                  disabled={testando}
                  onChange={(ev) => props.aoSimular(ev.target.checked)}
                />
                <span>Simular &quot;ainda sem crédito&quot;</span>
              </label>}
            </>
          )}
          {cer.situacao === "invalida" && (
            <Botao id="cfg-colar-chave" disabled={bloqueado} onClick={props.aoTrocarChave} iconeDepois={<Ic d={IC.seta} />}>
              Colar outra chave
            </Botao>
          )}
          {cer.ok && (
            <>
              <Botao variante="contorno" disabled={bloqueado} onClick={props.aoTrocarModelo}>
                Trocar o modelo
              </Botao>
              <Botao variante="contorno" disabled={bloqueado} onClick={props.aoTrocarChave}>
                Trocar a chave
              </Botao>
            </>
          )}
          <div className={c.cfDir}>
            <Botao variante="discreto" disabled={testando || bloqueado} onClick={props.aoTrocarMotor}>
              Trocar de provedor
            </Botao>
          </div>
        </div>
      )}
    </section>
  );
}
