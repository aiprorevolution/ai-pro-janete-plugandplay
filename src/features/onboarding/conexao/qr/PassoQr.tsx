import { useState, type ReactNode } from "react";

import { Aviso, Botao, cx } from "@/components/aipro";
import type { Classes } from "@/components/aipro/cx";
import type { GatewayQr } from "@/features/servidor/qr-conexao";

import { IC } from "../../lista/dados";
import { s as lista } from "../../lista/estilos";
import { Icone } from "../../lista/pecas";
import { irParaEntrar } from "../../lista/sessao";
import { DiscoQr, formaDoDisco, type EstadoDisco } from "./DiscoQr";
import type { EstadoLeituraQr } from "./useLeituraQr";
import estilos from "./PassoQr.module.css";

export { TEMPO_VOLTA_DISCO_MS, tempoVoltaDisco } from "./DiscoQr";

const s = estilos as Classes<
  | "passo"
  | "palco"
  | "cartao"
  | "cab"
  | "titulo"
  | "corpo"
  | "quadro"
  | "imagem"
  | "apagada"
  | "vazio"
  | "barra"
  | "sobreposto"
  | "passos"
  | "celular"
  | "viva"
  | "texto"
  | "erroLinha"
  | "pe"
  | "numero"
>;

/** Os textos da seção 2 da spec (spec-qr-whatsapp), mais os da seção 8 (o número). */
export const TEXTOS_QR = {
  estadoPalco: "Falta 1 passo",
  titulo: "Leia o QR code com o WhatsApp do celular",
  alt: "QR code para conectar o WhatsApp",
  passos: [
    "Abra o WhatsApp no celular do número que a Janete vai usar.",
    "Toque em ⋮ (Android) ou em Configurações (iPhone) e depois em Dispositivos conectados.",
    "Toque em Conectar dispositivo e aponte a câmera para o QR code.",
  ],
  /** O passo 1 quando o número informado vem (já formatado: "+55 11 98765-4321"). */
  passo1ComNumero: (numero: string) => `Abra o WhatsApp no celular do ${numero}.`,
  esperando: "Esperando a leitura. O QR code muda a cada 20 segundos.",
  celular: "Se o número é deste celular, abra esta tela no computador para ler o QR code.",
  carregando: "Gerando o QR code…",
  expirado: "O QR code expirou.",
  gerarOutro: "Gerar outro QR code",
  passkeyTitulo: "O WhatsApp pediu a chave de acesso",
  passkeyTexto:
    "Este celular pede uma confirmação extra (passkey), que só a Z-API consegue concluir. Termine a conexão pelo painel da Z-API, com a extensão Z-API Connector. Esta tela segue sozinha quando o número conectar.",
  conectado: "Celular conectado. Salvando a conexão…",
  tentarDeNovo: "Tentar de novo",
  entrarDeNovo: "Entrar de novo",
  diferenteTitulo: "Outro número leu o QR code",
  diferenteTexto: (conectado: string, informado: string) =>
    `Este celular é do ${conectado}, não do ${informado} que você informou.`,
  usarConectado: (conectado: string) => `Usar o ${conectado}`,
  desconectar: "Desconectar e ler de novo",
  desconectando: "Desconectando…",
} as const;

/** Um número formatado no meio de um texto: "+55 11 98765-4321", "+55 11 8765-4321" ou "+447911123456". */
const NUMERO_NO_TEXTO = /\+\d+(?:[ -]\d+)*/g;

/**
 * O texto com cada número formatado num trecho que não quebra no meio da linha (o texto não muda:
 * só os números ficam inteiros). Sem número, devolve o próprio texto.
 */
export function semQuebrarNumeros(texto: string): ReactNode {
  const partes: ReactNode[] = [];
  let ultimo = 0;
  for (const m of texto.matchAll(NUMERO_NO_TEXTO)) {
    const i = m.index ?? 0;
    if (i > ultimo) partes.push(texto.slice(ultimo, i));
    partes.push(
      <span key={i} className={s.numero}>
        {m[0]}
      </span>,
    );
    ultimo = i + m[0].length;
  }
  if (partes.length === 0) return texto;
  if (ultimo < texto.length) partes.push(texto.slice(ultimo));
  return partes;
}

/** O celular de outro número leu o QR (onboarding e troca): os números já vêm formatados. */
export interface DiferenteQr {
  conectado: string;
  informado: string;
  /** "Usar o {conectado}": só aparece quando vem. */
  aoUsar?: (() => void) | undefined;
  aoDesconectar: () => void;
  desconectando: boolean;
  /** A falha do "Desconectar e ler de novo" (ou do "Usar"), anunciada na hora. */
  erro?: string | null | undefined;
}

/**
 * O passo "Leia o QR code" da Z-API e da Evolution: no palco da validação (onboarding e troca de
 * WhatsApp na Configuração) ou dentro do cartão do número caído. Só mostra: quem pede o QR, conta
 * os 20 s e consulta a situação é o useLeituraQr.
 *
 * No palco, o QR fica no DiscoQr, o disco da validação que cresce e vira o quadro (seção 8 da
 * spec); no cartão, o QR fica ao lado dos passos, como antes.
 */
export function PassoQr(p: {
  estado: EstadoLeituraQr;
  gateway: GatewayQr;
  variante: "palco" | "cartao";
  idTitulo: string;
  aoGerarOutro: () => void;
  acoes: ReactNode;
  aoEntrarDeNovo?: () => void;
  /** O nível do título; o padrão vem da variante (palco: h2; cartão: h3). */
  nivel?: 2 | 3;
  /** O número informado, formatado: entra no passo 1. */
  numero?: string | undefined;
  /** Só no palco: o celular de outro número leu o QR. Quando vem, o `estado` não conta. */
  diferente?: DiferenteQr | undefined;
  /** Só no cartão: a linha de atenção acima do QR (por que o QR voltou). */
  aviso?: ReactNode;
}) {
  const { estado, gateway, variante, idTitulo, aoGerarOutro, acoes, aoEntrarDeNovo, nivel, numero } = p;
  const palco = variante === "palco";
  const diferente = palco ? p.diferente : undefined;
  const aviso = palco ? undefined : p.aviso;
  // o expirado (e o conectado) mostram o último QR, apagado: guardado aqui quando ele chega e
  // zerado no "carregando", para um QR velho não voltar depois
  const [ultima, setUltima] = useState<string | null>(null);
  if (estado.tipo === "qr" && estado.imagem !== ultima) setUltima(estado.imagem);
  if (estado.tipo === "carregando" && ultima !== null) setUltima(null);

  const vista: EstadoDisco = diferente ? { tipo: "diferente" } : estado;

  const H = (nivel ?? (palco ? 2 : 3)) === 2 ? "h2" : "h3";
  const titulo =
    vista.tipo === "diferente"
      ? TEXTOS_QR.diferenteTitulo
      : vista.tipo === "passkey"
        ? TEXTOS_QR.passkeyTitulo
        : vista.tipo === "erro"
          ? vista.titulo
          : TEXTOS_QR.titulo;
  const comQuadro =
    vista.tipo === "carregando" || vista.tipo === "qr" || vista.tipo === "expirado" || vista.tipo === "conectado";

  // a linha viva: o texto de cada estado, num lugar só
  let viva = "";
  if (diferente) viva = TEXTOS_QR.diferenteTexto(diferente.conectado, diferente.informado);
  else if (vista.tipo === "carregando") viva = TEXTOS_QR.carregando;
  else if (vista.tipo === "qr") viva = TEXTOS_QR.esperando;
  else if (vista.tipo === "expirado") viva = TEXTOS_QR.expirado;
  else if (vista.tipo === "conectado") viva = TEXTOS_QR.conectado;
  else if (vista.tipo === "passkey") viva = TEXTOS_QR.passkeyTexto;
  // o erro anuncia título e texto juntos: um erro de uma frase só tem título
  else if (vista.tipo === "erro") viva = [vista.titulo, vista.texto].filter(Boolean).join(" ");

  const imagem = vista.tipo === "qr" ? vista.imagem : vista.tipo === "carregando" ? null : ultima;
  const passos = numero ? [TEXTOS_QR.passo1ComNumero(numero), ...TEXTOS_QR.passos.slice(1)] : TEXTOS_QR.passos;

  // o botão some no próprio clique: o foco volta ao título, em vez de cair no body
  const gerarOutro = () => {
    aoGerarOutro();
    setTimeout(() => document.getElementById(idTitulo)?.focus({ preventScroll: true }), 0);
  };

  const listaPassos = (
    <ol className={s.passos}>
      {passos.map((t) => (
        <li key={t}>{semQuebrarNumeros(t)}</li>
      ))}
    </ol>
  );

  return (
    <div
      id={`${idTitulo}-passo`}
      className={cx(s.passo, palco ? s.palco : s.cartao)}
      data-estado={vista.tipo}
      data-gateway={gateway}
      data-forma={palco ? formaDoDisco(vista) : undefined}
    >
      <div className={s.cab}>
        {palco && (
          <p className={lista.estadoLinha} data-tom="atencao">
            <Icone d={IC.alerta} tamanho="p" />
            <span>{TEXTOS_QR.estadoPalco}</span>
          </p>
        )}
        <H id={idTitulo} tabIndex={-1} className={s.titulo}>
          {titulo}
        </H>
      </div>

      {/* no palco, o disco que vira o QR vem depois do título (a ordem do foco), mas fica em cima */}
      {palco && (
        <DiscoQr
          estado={vista}
          gateway={gateway}
          imagem={imagem}
          alt={TEXTOS_QR.alt}
          textoGerarOutro={TEXTOS_QR.gerarOutro}
          aoGerarOutro={gerarOutro}
        />
      )}

      {aviso && (
        <Aviso tom="atencao" compacto>
          {typeof aviso === "string" ? semQuebrarNumeros(aviso) : aviso}
        </Aviso>
      )}

      {comQuadro &&
        (palco ? (
          listaPassos
        ) : (
          <div className={s.corpo}>
            <div
              className={s.quadro}
              data-vazio={!imagem || undefined}
              data-carregando={vista.tipo === "carregando" || undefined}
            >
              {imagem ? (
                <img
                  src={imagem}
                  alt={TEXTOS_QR.alt}
                  width={232}
                  height={232}
                  className={cx(s.imagem, (vista.tipo === "expirado" || vista.tipo === "conectado") && s.apagada)}
                />
              ) : (
                <span className={s.vazio} aria-hidden="true" />
              )}
              {vista.tipo === "qr" && (
                // a barra dos 20 s recomeça a cada QR novo (a key muda)
                <span key={`${vista.rodada}-${vista.desde}`} className={s.barra} aria-hidden="true" />
              )}
              {vista.tipo === "expirado" && (
                <div className={s.sobreposto}>
                  <Botao tamanho="compacto" onClick={gerarOutro}>
                    {TEXTOS_QR.gerarOutro}
                  </Botao>
                </div>
              )}
            </div>
            {listaPassos}
          </div>
        ))}

      <p className={cx(s.viva, !comQuadro && s.texto)} aria-live="polite" data-estado={vista.tipo}>
        {semQuebrarNumeros(viva)}
      </p>
      {diferente?.erro && (
        <p className={s.erroLinha} role="alert">
          {semQuebrarNumeros(diferente.erro)}
        </p>
      )}
      {comQuadro && vista.tipo !== "conectado" && <p className={s.celular}>{TEXTOS_QR.celular}</p>}

      <div className={s.pe}>
        {diferente && (
          <>
            {diferente.aoUsar && (
              <Botao onClick={diferente.aoUsar} disabled={diferente.desconectando}>
                {semQuebrarNumeros(TEXTOS_QR.usarConectado(diferente.conectado))}
              </Botao>
            )}
            {/* o id: na falha do desconectar, o foco volta a este botão (o disabled o tirou dele) */}
            <Botao
              id={`${idTitulo}-desconectar`}
              variante="contorno"
              carregando={diferente.desconectando}
              onClick={diferente.aoDesconectar}
            >
              {diferente.desconectando ? TEXTOS_QR.desconectando : TEXTOS_QR.desconectar}
            </Botao>
          </>
        )}
        {vista.tipo === "erro" &&
          (vista.semSessao ? (
            <Botao onClick={aoEntrarDeNovo ?? irParaEntrar}>{TEXTOS_QR.entrarDeNovo}</Botao>
          ) : (
            <Botao onClick={gerarOutro}>{TEXTOS_QR.tentarDeNovo}</Botao>
          ))}
        {acoes}
      </div>
    </div>
  );
}
