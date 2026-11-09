import type { ReactNode } from "react";

import { Botao, Selo, cx } from "@/components/aipro";
import { s as lista } from "@/features/onboarding/lista";
import { DIFICULDADE, IC, MODOS } from "@/features/onboarding/lista/dados";

import { APONTA_QR, GATEWAY_QR, NOME_SITUACAO_W, urlWebhook } from "./dados";
import { c } from "./estilos";
import type { LeituraW } from "./leitura";
import { AvisoCartao, Ic, LinhaDl, LinhaEstado, LogoGateway } from "./pecas";

export type TesteW = "idle" | "testando" | "ok";

/** O conserto do WhatsApp caído: a ação principal e, às vezes, o contorno ao lado. */
export interface ConsertoW {
  texto: string;
  acao: () => void;
  /** A ação principal é "conferir com os dados guardados" (mostra "Conferindo…" e a simulação de falha). */
  conferir: boolean;
  contorno?: { texto: string; acao: () => void; conferir: boolean } | undefined;
}

interface Props {
  admin: boolean;
  w: LeituraW;
  teste: TesteW;
  /** Outra conferência em andamento (o "Conferir tudo"): trocar fica desligado. */
  bloqueado: boolean;
  realce: "flash" | "nasce" | null;
  oculto: boolean;
  conserto: ConsertoW | null;
  verWebhook: boolean;
  aoAlternarWebhook: () => void;
  verVerify: boolean;
  aoAlternarVerify: () => void;
  copiado: string | null;
  aoCopiar: (id: string, valor: string) => void;
  /** O "Simular falha" só existe na demo (o modo exemplo). */
  demo?: boolean | undefined;
  simular: boolean;
  aoSimular: (v: boolean) => void;
  /** O verify token guardado (lido do servidor quando o admin pede para ver ou copiar). */
  verifyToken?: string | null | undefined;
  aoTestar: () => void;
  aoTrocar: () => void;
  aoDesconectar: () => void;
  /** O Desconectar em andamento (até 8 s, o teto do desligar o webhook no provedor). */
  desconectando?: boolean | undefined;
  /** O webhook que ficou no provedor depois do Desconectar: fica no aviso até o próximo Desconectar. */
  lembreteWebhook?: string | undefined;
  /**
   * O passo do QR code (PassoQr variante "cartao"), aberto pelo "Mostrar o QR code": entra abaixo
   * do aviso, e o pé do cartão some enquanto ele está aberto (o "Cancelar" fica no próprio passo).
   */
  qr?: ReactNode;
}

/**
 * 1 · WhatsApp: o logo do gateway, o número, a situação, o gateway com o selo de dificuldade e o
 * tipo de conexão. O endereço do webhook e o verify token só aparecem na Meta: Zernio, Z-API e
 * Evolution recebem o webhook sozinhos. A atendente vê só a situação, sem botões.
 */
export function CartaoWhats(props: Props) {
  const { admin, w, teste, bloqueado, realce, oculto, conserto } = props;
  const prov = w.prov;
  const testando = teste === "testando";
  const modo = prov ? MODOS.find((m) => m.id === prov.modo) : undefined;
  const dif = prov ? DIFICULDADE[prov.dificuldade] : undefined;
  const temAviso = !!prov && (w.situacao === "desconectada" || w.situacao === "erro");
  // Z-API ou Evolution com o número fora do celular: o conserto é ler o QR code aqui no cartão
  const caiuQr = !!prov && !!GATEWAY_QR[prov.id] && ((w.situacao === "desconectada" && !w.manual) || w.conectando);
  const qrAberto = !!props.qr;
  // o texto dos avisos não muda ao abrir e fechar o QR (o leitor de tela releria tudo): a frase que
  // aponta o botão fica fora deles, só para o admin e só com o QR fechado
  const apontaQr = admin && caiuQr && !qrAberto && (temAviso || (w.conectando && !testando));

  const estado = testando
    ? w.ok
      ? "Testando…"
      : "Conferindo…"
    : !prov
      ? "Não conectado"
      : w.ok && teste === "ok"
        ? "Conectado · testado agora"
        : NOME_SITUACAO_W[w.situacao];
  const tom = testando || w.conectando ? "atencao" : w.ok ? "ok" : "erro";
  const icone = w.ok ? IC.ok : IC.alerta;

  const avisoTitulo =
    w.situacao === "erro"
      ? "O WhatsApp está com erro. As respostas da Janete não saem."
      : w.manual
        ? "WhatsApp desconectado. A Janete não recebe nem responde mensagens."
        : "O WhatsApp desconectou. A Janete não recebe nem responde mensagens.";

  // só a Meta pede para colar o endereço e o token no painel dela
  const temWebhook = admin && !!prov && prov.id === "meta" && !temAviso && !w.conectando && !!w.conexao;
  const gerados = temWebhook
    ? [
        { id: "url", label: "Endereço do webhook", valor: urlWebhook("meta", w.conexao!.id), segredo: false },
        { id: "verify", label: "Verify token", valor: props.verifyToken ?? "[verify token desta conexão]", segredo: true },
      ]
    : [];

  return (
    <section
      id="cfg-card-whats"
      className={cx(c.cfCartao, c.cfBlk, oculto && c.cfOculto)}
      data-realce={realce ?? undefined}
      aria-labelledby="cfg-m-whats cfg-h-whats"
    >
      <header className={c.cfBlkCab}>
        {prov ? (
          <LogoGateway prov={prov} gira={testando} />
        ) : (
          <span className={lista.linhaIcone} aria-hidden="true">
            <Ic d={IC.alerta} tamanho="g" />
          </span>
        )}
        <div className={c.cfBlkTitulo}>
          <p className={c.cfMeta} id="cfg-m-whats">
            WhatsApp
          </p>
          <h2 id="cfg-h-whats" tabIndex={-1} className={cx(c.cfBlkH, prov && c.cfMono)}>
            {prov ? w.numero : "Nenhum número conectado"}
          </h2>
        </div>
        <LinhaEstado tom={tom} icone={icone} girando={testando || w.conectando} vivo>
          {estado}
        </LinhaEstado>
      </header>

      {temAviso && (
        <AvisoCartao tom="erro" icone={IC.alerta} titulo={avisoTitulo} papel="alert">
          <span>
            {w.erro}
            {admin && w.manual && props.lembreteWebhook ? ` ${props.lembreteWebhook}` : ""}
            {admin ? "" : " Avise quem administra a conta."}
          </span>
        </AvisoCartao>
      )}
      {!prov && (
        <AvisoCartao tom="erro" icone={IC.alerta} titulo="Nenhum WhatsApp conectado. A Janete não recebe nem responde mensagens.">
          {!admin && <span>Avise quem administra a conta.</span>}
        </AvisoCartao>
      )}
      {prov && w.conectando && (
        <AvisoCartao
          tom="atencao"
          girando
          papel="status"
          titulo={
            testando
              ? `Conferindo com a ${prov.curto}…`
              : GATEWAY_QR[prov.id]
                ? "Conectando… aguardando a leitura do QR code."
                : `Conectando… esperando a ${prov.curto} confirmar.`
          }
        >
          <span>
            {testando
              ? "Usando os dados guardados. Nada precisa ser colado de novo."
              : GATEWAY_QR[prov.id]
                ? `Falta ler o QR code com o celular do número.${admin ? "" : " Avise quem administra a conta."}`
                : `Esperando a ${prov.curto} confirmar a conexão. Assim que o número conectar, a Janete volta a atender.${
                    admin ? "" : " Avise quem administra a conta."
                  }`}
          </span>
        </AvisoCartao>
      )}
      {apontaQr && <p className={c.cfApoio}>{APONTA_QR}</p>}
      {admin && props.qr}

      {prov && modo && dif && (
        <dl className={c.cfBlkDl}>
          <LinhaDl rotulo="Gateway">
            <span>{prov.nome}</span>
            <Selo compacto tom={dif.tom}>
              <span className={c.cfSr}>Dificuldade: </span>
              {dif.rotulo}
            </Selo>
          </LinhaDl>
          <LinhaDl rotulo="Tipo de conexão">
            <LinhaEstado tom={modo.estadoClasse} icone={modo.estadoIcone}>
              {modo.resumo}. {modo.selo}.
            </LinhaEstado>
          </LinhaDl>
        </dl>
      )}

      {/* o webhook só serve na montagem: fica recolhido e some quando há um aviso de erro */}
      {temWebhook && (
        <div className={c.cfAbre}>
          <button
            type="button"
            className={c.cfAbreBotao}
            aria-expanded={props.verWebhook}
            aria-controls="cfg-webhook"
            onClick={props.aoAlternarWebhook}
          >
            <Ic d={IC.chevronDireita} tamanho="p" />
            <span>{props.verWebhook ? "Esconder o endereço do webhook" : "Ver o endereço do webhook"}</span>
          </button>
          {props.verWebhook && (
            <div className={lista.bloco} id="cfg-webhook">
              <p className={c.cfMeta}>Gerado por nós. Cole no painel da Meta, no campo do webhook.</p>
              {gerados.map((g) => {
                const copiado = props.copiado === `c-${g.id}`;
                const oculto = g.segredo && !props.verVerify;
                return (
                  <div key={g.id} className={lista.gerado}>
                    <div className={lista.geradoTexto}>
                      <span className={lista.geradoRotulo}>{g.label}</span>
                      <code className={cx(lista.geradoValor, c.cfGeradoValor, c.cfMono)}>
                        {oculto ? "••••••••••••••••" : g.valor}
                      </code>
                    </div>
                    <div className={c.cfGeradoAcoes}>
                      {g.segredo && (
                        <button
                          type="button"
                          className={lista.olhar}
                          onClick={props.aoAlternarVerify}
                          aria-label={`${props.verVerify ? "Ocultar" : "Mostrar"} ${g.label.toLowerCase()}`}
                        >
                          {props.verVerify ? "Ocultar" : "Mostrar"}
                        </button>
                      )}
                      <Botao
                        variante="contorno"
                        className={cx(lista.btnC, lista.btnCopiar, copiado && lista.copiado)}
                        icone={<Ic d={copiado ? IC.feito : IC.copiar} tamanho="p" />}
                        aria-label={copiado ? `${g.label} copiado` : `Copiar ${g.label.toLowerCase()}`}
                        onClick={() => props.aoCopiar(`c-${g.id}`, g.valor)}
                      >
                        {copiado ? "Copiado" : "Copiar"}
                      </Botao>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* com o QR aberto, o pé some: trocar, colar de novo e o próprio "Mostrar o QR code" competiriam
          com o passo, que tem o seu "Cancelar" */}
      {admin && !qrAberto && (
        <div className={c.cfBlkPe}>
          {/* durante um teste (deste cartão, da chave ou o "Conferir tudo") nada se troca nem se desliga */}
          {/* desconectando, o botão fica com o indicador de espera (os outros já estão desligados) */}
          {w.ok && !testando && (!bloqueado || props.desconectando) && (
            <Botao
              id="cfg-desconectar"
              variante="perigo"
              className={cx(c.cfBtnC, c.cfPerigoLeve)}
              carregando={props.desconectando}
              disabled={props.desconectando}
              onClick={props.aoDesconectar}
            >
              {props.desconectando ? "Desconectando…" : "Desconectar"}
            </Botao>
          )}
          {props.demo && conserto && (conserto.conferir || conserto.contorno?.conferir) && (
            <label className={c.cfSim} htmlFor="cfg-sim-w">
              <input
                id="cfg-sim-w"
                type="checkbox"
                checked={props.simular}
                disabled={testando}
                onChange={(ev) => props.aoSimular(ev.target.checked)}
              />
              <span>Simular falha na demo</span>
            </label>
          )}
          <div className={c.cfDir}>
            {w.ok && (
              <Botao id="cfg-testar-whats" variante="contorno" carregando={testando} disabled={bloqueado} onClick={props.aoTestar}>
                {testando ? "Testando…" : "Testar a conexão agora"}
              </Botao>
            )}
            {prov && (
              <Botao variante="contorno" disabled={testando || bloqueado} onClick={props.aoTrocar}>
                Trocar de WhatsApp
              </Botao>
            )}
            {conserto?.contorno && (
              <Botao variante="contorno" disabled={testando || bloqueado} onClick={conserto.contorno.acao}>
                {conserto.contorno.texto}
              </Botao>
            )}
            {conserto && (
              <Botao
                id="cfg-conserto-w"
                carregando={testando && conserto.conferir}
                disabled={testando || bloqueado}
                onClick={conserto.acao}
              >
                {testando && conserto.conferir ? "Conferindo…" : conserto.texto}
              </Botao>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
