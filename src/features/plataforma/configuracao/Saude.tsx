import { useRouter } from "@tanstack/react-router";

import { Botao, cx } from "@/components/aipro";
import { JaneteSimbolo, type EstadoJanete } from "@/components/janete/JaneteSimbolo";
import { IC } from "@/features/onboarding/lista/dados";

import { avisoCamposFracos, camposFracos } from "../contexto/regras";
import { useDados } from "../dados/ProvedorDados";
import type { Leitura, VersaoContextoBanco } from "../dados/tipos";
import { GATEWAY_QR, MOSTRAR_QR, NOME_SITUACAO_C, NOME_SITUACAO_W, deNome } from "./dados";
import { c } from "./estilos";
import { motorParado, soAtrasada, type LeituraC, type LeituraE, type LeituraMotor, type LeituraV, type LeituraW } from "./leitura";
import { ICX, Ic } from "./pecas";

/** As peças, como o fio mostra (na ordem da mensagem) e como os cartões se chamam. */
export type Peca = "whats" | "escuta" | "ritmo" | "cerebro" | "voz";

/** Quantas peças o fio tem (e o "Conferir tudo" confere), e a última: a voz (P13 do uso da voz). */
export const NOS_DO_FIO = 5;
export const ULTIMO_NO = NOS_DO_FIO - 1;

/** O estado de um nó do fio. `desconhecido`: a atendente não vê a chave (fica neutro). */
export type EstadoNo = "ok" | "atencao" | "erro" | "ativo" | "desconhecido" | "";
export type EstadoSeg = "cheio" | "fixo" | "cheio fixo" | "quebrado" | "";

/** "Conferir tudo agora": uma peça de cada vez, sem falar com nenhum lead. */
export interface Teste {
  rodando: boolean;
  nos: EstadoNo[] | null;
  segs: EstadoSeg[] | null;
  /** O trecho do fio por onde a gota anda agora. */
  anda: number;
  fim: "ok" | "erro" | null;
  /** Onde parou (0 = WhatsApp, 2 = ritmo, 3 = cérebro; a voz, 4, nunca para). */
  onde: number;
  /** O motivo de onde parou, já em texto (a resposta da conferência de verdade). */
  motivo?: string | undefined;
}

export const SEM_TESTE: Teste = { rodando: false, nos: null, segs: null, anda: -1, fim: null, onde: -1 };

/** O símbolo da Janete no cartão da saúde, por cima do repouso: conferindo ou tudo certo. */
export type HeroJanete = "carregando" | "check" | null;

const MOTIVO_CHAVE: Partial<Record<LeituraC["situacao"], string>> = {
  sem_credito: "está sem crédito.",
  invalida: "foi recusada.",
  removida: "foi removida.",
};

const DEFS: readonly { peca: Peca; verbo: string; nome: string; grande: boolean }[] = [
  { peca: "whats", verbo: "Recebe", nome: "WhatsApp", grande: true },
  { peca: "escuta", verbo: "Escuta", nome: "Áudios em texto", grande: false },
  { peca: "ritmo", verbo: "Espera", nome: "Junta as mensagens", grande: false },
  { peca: "cerebro", verbo: "Responde", nome: "Cérebro", grande: true },
  { peca: "voz", verbo: "Fala", nome: "Voz da Janete", grande: false },
];

/**
 * O nó da voz (P13): neutro sem chave ou no modo "Nunca"; ok com a chave ativa, a voz escolhida e
 * sem erro; atenção nos outros casos. Nunca erro: a falha da fala vira texto, a Janete não para.
 */
export function noDaVoz(voz: LeituraV | undefined): EstadoNo {
  if (!voz || !voz.conhecida || !voz.chave || voz.modo === "nunca") return "desconhecido";
  return voz.ok ? "ok" : "atencao";
}

/**
 * O repouso do fio: o estado de cada nó, na ordem da mensagem. O ritmo só fica verde quando a
 * Janete está atendendo (decisão 10d): com o onboarding aberto, ele é o nó que para. A Janete atrasada
 * não está parada (decisão do equipe, 03/11/2026): o ritmo fica em atenção.
 * Sem uma leitura válida do motor (no banco), ele fica neutro: a tela não afirma que está em dia.
 */
export function nosEmRepouso(w: LeituraW, esc: LeituraE, cer: LeituraC, andamento?: LeituraMotor, voz?: LeituraV): EstadoNo[] {
  const parouMotor = !!andamento && motorParado(andamento);
  const saudavel =
    w.ok && (!cer.conhecida || cer.ok) && !parouMotor && andamento?.estado !== "sem_leitura";
  const ritmo: EstadoNo =
    andamento?.estado === "atrasado" ? "atencao" : parouMotor ? "erro" : saudavel ? "ok" : "desconhecido";
  return [
    w.ok ? "ok" : w.conectando ? "ativo" : "erro",
    !esc.conhecida ? "desconhecido" : esc.ok ? "ok" : "atencao",
    ritmo,
    !cer.conhecida ? "desconhecido" : cer.ok ? "ok" : "erro",
    noDaVoz(voz),
  ];
}

/** O detalhe do nó do ritmo no fio: o atraso, o onboarding aberto, a cópia antes da 1ª mensagem, ou o ritmo. */
function detalheRitmo(andamento: LeituraMotor | undefined, espera: number, teto: number): string {
  if (andamento?.estado === "atrasado")
    return `Atrasada há ${andamento.minutos} min: a resposta está demorando`;
  if (andamento?.estado === "onboarding") return "Parada até o onboarding ser concluído";
  if (andamento?.estado === "aguardando")
    return "A Janete liga sozinha quando chegar a primeira mensagem";
  return `Espera ${espera} s, no máximo ${teto} s`;
}

/** O detalhe do nó da voz no fio (some abaixo de 600 px; vai sempre no aria-label). */
function detalheVoz(voz: LeituraV | undefined): string {
  if (!voz || !voz.conhecida) return "Só quem administra vê";
  if (!voz.chave) return "Não configurada · responde em texto";
  if (voz.modo === "nunca") return "Desligada · responde em texto";
  if (voz.ok && voz.voz) return `Ativa · ${voz.voz.nome}`;
  if (voz.aviso === "sem_credito") return `${NOME_SITUACAO_C.sem_credito} · responde em texto`;
  // a chave sem um acesso é uma chave inválida: o mesmo detalhe (o motivo fica no cartão)
  if (voz.aviso === "invalida" || voz.aviso === "sem_permissao") return `${NOME_SITUACAO_C.invalida} · responde em texto`;
  if (voz.aviso === "voz_nao_encontrada") return "Voz não encontrada · responde em texto";
  return "Sem voz escolhida · responde em texto";
}

/**
 * O texto do aviso do motor (spec-motor-acordado, decisão 3), ou vazio: só o trabalho esperando há
 * mais de 3 min (dia calmo não avisa) e o onboarding aberto. O "aguardando" não é aviso.
 */
export function avisoMotor(andamento: LeituraMotor | undefined): { titulo: string; sub: string } | null {
  if (!andamento) return null;
  if (andamento.estado === "onboarding")
    return {
      titulo: "A Janete ainda não atende",
      sub: "O onboarding ainda não foi concluído: a Janete não atende. As mensagens chegam, mas ficam sem resposta até ele ser concluído.",
    };
  if (andamento.estado === "atrasado")
    return {
      titulo: `A Janete está atrasada há ${andamento.minutos} min`,
      sub: "As mensagens chegam, mas a resposta está demorando. A Janete já foi chamada de novo; se continuar, confira a conexão e as chaves.",
    };
  return null;
}

/**
 * O aviso do Contexto fraco (decisão 7): o mesmo texto do cabeçalho do Contexto (avisoCamposFracos),
 * com o ponto final, porque aqui vem uma frase depois. Discreto: não muda a cor da Saúde nem para a
 * Janete. Carregando ou com a leitura em erro, não aparece (camposFracos(undefined)); sem versão, os 8
 * contam.
 */
export function avisoContextoFraco(contexto: Pick<Leitura<VersaoContextoBanco | null>, "dados" | "erro">): string | null {
  const aviso = avisoCamposFracos(camposFracos(contexto.erro ? undefined : contexto.dados));
  return aviso ? `${aviso}.` : null;
}

interface Props {
  /** Some enquanto o fluxo ocupa a tela cheia (o cartão é o item da grade: assim o sticky funciona). */
  oculto: boolean;
  admin: boolean;
  w: LeituraW;
  cer: LeituraC;
  esc: LeituraE;
  /** A voz da Janete: o 5º nó, "Fala" (sem ela, o nó fica neutro). */
  voz?: LeituraV | undefined;
  /** O ritmo salvo. */
  espera: number;
  teto: number;
  /** O andamento do trabalho da Janete, lido do motor (sem ele, como no exemplo, não avisa). */
  andamento?: LeituraMotor | undefined;
  teste: Teste;
  hero: HeroJanete;
  /** O conserto principal (só o admin, com a Janete parada). */
  conserto: { texto: string; acao: () => void } | null;
  /** O QR code já está aberto no cartão do WhatsApp: a frase aponta para ele. */
  qrAberto?: boolean | undefined;
  testeBloqueado: boolean;
  aoTestarTudo: () => void;
  aoIr: (peca: Peca) => void;
}

/** O texto do topo do cartão: o olho, o título e a frase. Também vai para o leitor de tela. */
export function textosSaude({
  w,
  cer,
  esc,
  voz,
  teste,
  andamento,
  admin = true,
  qrAberto = false,
}: Pick<Props, "w" | "cer" | "esc" | "voz" | "teste" | "andamento" | "qrAberto"> & { admin?: boolean | undefined }): {
  olho: string;
  titulo: string;
  sub: string;
} {
  const curto = w.prov?.curto ?? "";
  const motor = cer.motor;
  const ativo = teste.nos ? teste.nos.indexOf("ativo") : -1;
  if (teste.rodando) {
    return {
      olho: "Conferindo agora",
      titulo: "Conferindo as cinco peças",
      sub: [
        `Conferindo a conexão com a ${curto}…`,
        // a chave só de áudio inválida não transcreve: o servidor usa o cérebro ou a voz
        esc.ok && esc.transcritor && !esc.viaCerebro && !esc.viaVoz
          ? `Conferindo a chave de transcrição ${deNome(esc.transcritor)}…`
          : "Conferindo a escuta de áudio…",
        "Conferindo o ritmo…",
        `Pedindo uma resposta de teste ao cérebro ${deNome(motor)}…`,
        voz?.chave ? "Conferindo a voz da Janete na ElevenLabs…" : "Conferindo a voz da Janete…",
      ][Math.max(0, ativo)]!,
    };
  }
  if (teste.fim === "ok") {
    // o nó da voz nunca para a conferência: em atenção, a frase diz que o áudio sairia em texto
    const noVoz = teste.nos?.[ULTIMO_NO];
    const quem = ["A conexão", ...(esc.ok ? ["a escuta"] : []), "o cérebro", ...(noVoz === "ok" ? ["a voz"] : [])];
    const responderam = `${quem.slice(0, -1).join(", ")} e ${quem[quem.length - 1]} responderam.`;
    return {
      olho: "Conferido agora",
      titulo: "Tudo certo nas cinco peças",
      sub:
        responderam +
        (esc.ok ? " Nenhum lead recebeu mensagem." : " Só os áudios ainda não viram texto: a Janete pede para o lead escrever.") +
        (noVoz === "atencao" ? " As respostas em áudio sairiam em texto." : ""),
    };
  }
  if (teste.fim === "erro") {
    return {
      olho: "Conferido agora",
      titulo:
        teste.onde === 0
          ? "A conferência parou no WhatsApp"
          : teste.onde === 2
            ? "A conferência parou no ritmo"
            : "A conferência parou no cérebro",
      sub:
        teste.motivo ??
        (teste.onde === 0
          ? `A ${curto} não confirmou o número conectado.`
          : `O cérebro não respondeu: a chave ${deNome(motor)} ${MOTIVO_CHAVE[cer.situacao] ?? "foi recusada."}`),
    };
  }
  if (w.conectando) {
    return {
      olho: "Quase lá",
      titulo: "Esperando o WhatsApp conectar",
      // só Z-API e Evolution conectam pelo QR code; Meta e Zernio passam por aqui no "Conferir de novo"
      // o QR code se lê no cartão ("Mostrar o QR code", ou o próprio QR, já aberto); a atendente não tem o botão
      sub: `${
        w.prov && GATEWAY_QR[w.prov.id]
          ? admin
            ? qrAberto
              ? "Leia o QR code no cartão do WhatsApp."
              : `Leia o QR code em "${MOSTRAR_QR}".`
            : "Falta ler o QR code com o celular do número."
          : `Esperando a ${curto} confirmar a conexão.`
      } Assim que o número conectar, a Janete volta a atender.`,
    };
  }
  if (!w.ok) {
    return {
      olho: "Precisa de você",
      titulo: "A Janete parou de atender",
      sub: !w.prov
        ? "Nenhum WhatsApp conectado. As mensagens dos leads não chegam até ela."
        : w.situacao === "erro"
          ? `A ${curto} está respondendo com erro. As respostas da Janete não saem.`
          : "O WhatsApp desconectou. As mensagens dos leads não chegam até ela.",
    };
  }
  const aw = avisoMotor(andamento);
  if (aw) return { olho: "Precisa de você", titulo: aw.titulo, sub: aw.sub };
  if (!cer.conhecida) {
    // a atendente não vê a chave: diz só o que sabe (o WhatsApp), sem afirmar que a Janete responde
    return {
      olho: "Agora",
      titulo: "O WhatsApp está recebendo",
      sub: `Recebe pela ${curto}, 24 horas por dia. A situação do cérebro e da escuta de áudio só aparece para quem administra a conta.`,
    };
  }
  if (!cer.ok) {
    return {
      olho: "Precisa de você",
      titulo: "A Janete parou de responder",
      sub:
        (cer.situacao === "removida"
          ? "A Janete está sem chave de IA."
          : `A chave ${deNome(motor)} ${cer.situacao === "sem_credito" ? "ficou sem crédito." : "foi recusada."}`) +
        " As mensagens chegam, mas ninguém responde.",
    };
  }
  return {
    olho: "Agora",
    titulo: "A Janete está atendendo",
    sub:
      `Recebe pela ${curto} e responde com o ${cer.nomeModelo}, 24 horas por dia.${esc.ok ? "" : " Os áudios ainda não viram texto: a Janete pede para o lead escrever."}` +
      (noDaVoz(voz) === "atencao" ? " As respostas em áudio estão saindo em texto." : "") +
      // a frase da decisão 3 também no celular, onde o detalhe do nó do ritmo some
      (andamento?.estado === "aguardando"
        ? " A Janete liga sozinha quando chegar a primeira mensagem."
        : ""),
  };
}

/**
 * A saúde da Janete: o símbolo dela (respira quando está tudo bem, dorme quando parada, gira ao
 * conferir, check quando dá certo), a frase e o fio com as 5 peças na ordem da mensagem (a voz por
 * último: a fala é a forma da resposta).
 */
export function Saude(props: Props) {
  const { admin, w, cer, esc, voz, espera, teto, andamento, teste, hero, conserto, testeBloqueado, aoTestarTudo, aoIr } = props;
  const parouMotor = !!andamento && motorParado(andamento);
  const parado = !w.ok || (cer.conhecida && !cer.ok) || parouMotor;
  // só o atraso não põe a Janete para dormir: ela segue respondendo, com demora
  const atrasada = soAtrasada(w, cer, andamento);
  const contextoFraco = avisoContextoFraco(useDados().useContextoAtual());
  // sem roteador (a Saúde montada sozinha num teste), o link do Contexto navega pela página
  const router = useRouter({ warn: false });

  let janete: EstadoJanete =
    parado && !atrasada ? (w.conectando ? "carregando" : "dormindo") : "acordada";
  if (teste.rodando) janete = "carregando";
  if (hero) janete = hero;
  const rotuloJanete: Record<EstadoJanete, string> = {
    // a atendente não vê o cérebro: o rótulo não afirma que a Janete responde (o título também não)
    acordada: atrasada
      ? "Janete, atrasada"
      : cer.conhecida
        ? "Janete, atendendo"
        : "Janete, recebendo mensagens",
    dormindo: "Janete, parada",
    carregando: "Janete, conferindo",
    check: "Janete, tudo certo",
    fala: "Janete",
  };

  const { olho, titulo, sub } = textosSaude(props);

  // em repouso o fio já diz a saúde: navy entre peças que funcionam, tracejado depois de uma parada
  const repouso = nosEmRepouso(w, esc, cer, andamento, voz);
  const nos = teste.nos ?? repouso;
  const parou = repouso.map((n) => n === "erro" || n === "ativo");
  // um trecho entre cada par de nós
  const segsRepouso: EstadoSeg[] = Array.from({ length: ULTIMO_NO }, (_, i) => i).map((i) => {
    if (parou.slice(0, i + 1).some(Boolean)) return "quebrado";
    return parou[i + 1] ? "fixo" : "cheio fixo";
  });
  const segs = teste.segs ? teste.segs.map((x) => x || "fixo") : segsRepouso;

  const curto = w.prov?.curto ?? "";
  const dets = [
    w.prov ? `${NOME_SITUACAO_W[w.situacao]} · ${curto}` : "Nenhum WhatsApp conectado",
    !esc.conhecida
      ? "Só quem administra vê"
      : esc.ok && esc.viaCerebro
        ? `Ativa · chave do cérebro (${esc.nomeViaCerebro})`
        : esc.ok && esc.viaVoz
          ? "Ativa · chave da voz (ElevenLabs)"
          : esc.ok
            ? `Ativa · ${esc.transcritor?.nome ?? ""}`
            : esc.chave
              ? `${NOME_SITUACAO_C[esc.chave.status]} · a Janete pede texto`
              : esc.viaVoz && voz?.chave
                ? `Chave da voz: ${NOME_SITUACAO_C[voz.chave.status].toLowerCase()} · a Janete pede texto`
                : "Não configurada · a Janete pede texto",
    detalheRitmo(andamento, espera, teto),
    !cer.conhecida
      ? "Só quem administra vê"
      : cer.situacao === "removida"
        ? "Sem chave de IA"
        : `${cer.ok ? "Ativa" : NOME_SITUACAO_C[cer.situacao]} · ${cer.nomeModelo}`,
    detalheVoz(voz),
  ];
  // o detalhe da atenção na conferência, de cada nó que pode ficar em atenção
  const ATENCAO: Partial<Record<Peca, string>> = {
    escuta: "Sem escuta: a Janete pediria texto",
    voz: "Sem fala: a resposta iria em texto",
  };

  const testarTexto = teste.rodando ? "Conferindo…" : teste.fim ? "Conferir de novo" : "Conferir tudo agora";
  const testarNota = teste.rodando
    ? "Uma peça de cada vez, sem falar com nenhum lead."
    : teste.fim
      ? "Última conferência: agora"
      : "Confere as cinco peças agora, sem falar com nenhum lead.";

  return (
    <section className={cx(c.cfCartao, c.cfSaude, props.oculto && c.cfOculto)} aria-labelledby="cfg-saude-titulo" data-testid="cfg-saude">
      <div className={c.cfSaudeTopo}>
        <div className={c.cfSaudeSim}>
          <span className={c.cfHalo} aria-hidden="true" data-apagado={janete === "acordada" || janete === "check" ? undefined : ""} />
          <JaneteSimbolo estado={janete} tamanho={56} rotulo={rotuloJanete[janete]} data-testid="cfg-janete" />
        </div>
        <div className={c.cfSaudeTxt}>
          <p className={c.cfOlho}>{olho}</p>
          <h2 id="cfg-saude-titulo" className={c.cfSaudeTitulo}>
            {titulo}
          </h2>
        </div>
      </div>
      <p className={cx(c.cfApoio, c.cfSaudeSub)}>{sub}</p>
      <div>
        <p className={cx(c.cfMeta, c.cfFioRot)} id="cfg-fio-rot">
          O caminho de cada mensagem
        </p>
        <ol className={c.cfFio} aria-labelledby="cfg-fio-rot">
          {DEFS.map((d, i) => {
            const n = nos[i] ?? "";
            let det = dets[i]!;
            if (teste.nos && n === "ativo") det = "Conferindo…";
            else if (teste.nos && n === "erro") det = "A conferência parou aqui";
            else if (teste.nos && n === "atencao") det = ATENCAO[d.peca] ?? det;
            // parada e atenção com ícones diferentes: abaixo de 600 px o detalhe some, e a cor sozinha não basta
            const icone = n === "ok" ? ICX.check : n === "erro" ? ICX.fechar : n === "atencao" ? ICX.exclama : "";
            const efeito = teste.nos && n && n !== "ativo" ? (n === "erro" ? "treme" : "pousa") : undefined;
            const tom = n === "erro" ? "erro" : n === "atencao" ? "atencao" : n === "ativo" && !teste.nos ? "ativo" : undefined;
            const seg = i < ULTIMO_NO ? (segs[i] ?? "") : "";
            return (
              <li key={d.peca} className={c.cfEstLi}>
                <button
                  type="button"
                  className={c.cfEst}
                  data-tom={tom}
                  data-peca={d.peca}
                  onClick={() => aoIr(d.peca)}
                  aria-label={`${d.verbo}, ${d.nome}: ${det}. Ver os detalhes.`}
                >
                  <span className={c.cfNoCol}>
                    <span
                      className={c.cfNo}
                      data-estado={n === "desconhecido" ? undefined : n || undefined}
                      data-p={d.grande ? undefined : ""}
                      data-efeito={efeito}
                    >
                      <Ic d={icone} />
                    </span>
                  </span>
                  <span className={c.cfEstTxt}>
                    <span className={c.cfEstVerbo}>{d.verbo}</span>
                    <span className={c.cfEstNome}>{d.nome}</span>
                    <span className={c.cfEstDet}>{det}</span>
                  </span>
                  <Ic d={IC.chevronDireita} className={c.cfEstSeta} />
                </button>
                {i < ULTIMO_NO && (
                  <span
                    className={c.cfSegFio}
                    aria-hidden="true"
                    data-cheio={seg.includes("cheio") || undefined}
                    data-fixo={seg.includes("fixo") || undefined}
                    data-quebrado={seg === "quebrado" || undefined}
                    data-anda={teste.anda === i || undefined}
                  >
                    <i />
                    <b className={c.cfGota} />
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      {contextoFraco && (
        <p className={c.cfAviso} data-tom="info" data-testid="cfg-contexto-fraco">
          <Ic d={IC.alerta} />
          <span>
            {contextoFraco}{" "}
            {/* só o admin muda o Contexto: a atendente avisa quem administra, como no pé da Saúde */}
            {admin ? (
              <a
                href="/app/contexto"
                onClick={(ev) => {
                  // só o clique simples: Ctrl, Cmd, Shift, Alt ou o botão do meio abrem como o navegador quiser
                  if (!router || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
                  ev.preventDefault();
                  void router.navigate({ to: "/app/contexto" });
                }}
              >
                Completar o Contexto
              </a>
            ) : (
              "Avise quem administra a conta: só essa pessoa muda o Contexto."
            )}
          </span>
        </p>
      )}
      {/* sem conteúdo (atendente com tudo funcionando), o pé não sai: vazio, somava o vão do cartão */}
      {(conserto || admin || parado) && (
        <div className={c.cfSaudePe}>
          {conserto && (
            <Botao largo onClick={conserto.acao} iconeDepois={<Ic d={IC.seta} />}>
              {conserto.texto}
            </Botao>
          )}
          {!admin && parado && (
            <p className={c.cfAviso} data-tom="atencao">
              <Ic d={IC.triangulo} />
              <span>Avise quem administra a conta. Só essa pessoa troca a conexão e as chaves.</span>
            </p>
          )}
          {admin && (
            <>
              <Botao
                id="cfg-testar-tudo"
                variante="contorno"
                largo
                carregando={teste.rodando}
                disabled={testeBloqueado}
                icone={<Ic d={ICX.pulso} />}
                onClick={aoTestarTudo}
              >
                {testarTexto}
              </Botao>
              <p className={c.cfMeta}>{testarNota}</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
