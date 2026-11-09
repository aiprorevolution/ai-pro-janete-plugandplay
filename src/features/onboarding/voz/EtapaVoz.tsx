import { useEffect, useRef, useState } from "react";

import { Botao, Campo, cx } from "@/components/aipro";
import { medirJanete, movimentoReduzido, rolarAteEMedir, useVooJanete } from "@/components/janete/VooJanete";
import type { PropsEtapa } from "@/features/onboarding/Onboarding";
import { useOnboarding } from "@/features/onboarding/estado";
import { useJaneteNoPalco, usePalco } from "@/features/onboarding/palco";
import type { EntradaSalvarChaveIA, ResultadoSalvarChaveIA } from "@/features/mensageria/configuracao.functions";
import { useDadosOnboarding } from "@/features/plataforma/dados/onboarding";

import {
  AvisoErro,
  BlocoOk,
  BotaoCompacto,
  CartaoLista,
  ListaDeVozes,
  FASES_PALCO,
  GIRO_IA_MS,
  IC,
  Icone,
  LOGO,
  LogoTile,
  MENSAGEM_SEM_RESPOSTA,
  MENSAGEM_SEM_SESSAO,
  PainelCab,
  PalcoValidacao,
  acharMotor,
  focarAgora,
  irParaEntrar,
  lerCampo,
  limparCampo,
  mensagemDoResultado,
  s,
  separarMensagem,
  sessaoTerminou,
  useDepois,
  useListaVozes,
  useValidacao,
  type Desfecho,
  type EntradaCartao,
  type Fase,
} from "../lista";

/** O campo da chave (não controlado, ver lista/campos.ts): a chave fica só no `<input>`. */
export const ID_CHAVE_VOZ = "chave-elevenlabs";
/** Tamanho mínimo da chave para liberar "Validar chave" (o mesmo do Cérebro). */
const CHAVE_MINIMA = 8;
/** Do pouso da Janete sobre o check até a etapa avançar (P6 da spec da voz). */
const POUSO_MS = 240;
/** A chegada do despertar: o voo até a mira dura 900 ms, o cartão nasce 180 ms depois e leva 780 ms. */
const VOO_MS = 900;
const NASCE_APOS_MS = 1080;
const NASCE_MS = 780;

const PASSOS: readonly string[] = ["Falando com a ElevenLabs", "Conferindo a chave", "Conferindo os créditos da conta"];

/** A gravação da voz caiu antes de responder (a MENSAGEM_SEM_RESPOSTA fala em "teste", que aqui não há). */
const MENSAGEM_VOZ_SEM_RESPOSTA = "Não conseguimos salvar a voz agora. Confira a sua internet e tente de novo em instantes.";

/** A falha de gravar a voz, dentro do bloco da lista. */
interface ErroVozEscolhida {
  titulo: string;
  texto: string;
  semSessao: boolean;
}

/** Os códigos de recusa do salvarChaveIA (a chave, o acesso e a gravação). */
type CodigoErroVoz = Extract<ResultadoSalvarChaveIA, { ok: false }>["erro"];

interface ErroVozTela {
  codigo: CodigoErroVoz | null;
  titulo: string;
  texto: string;
  /** A chamada foi recusada porque a sessão terminou: a ação leva para o login. */
  semSessao?: boolean;
}

const ERROS_DE_CHAVE: readonly string[] = ["chave_invalida", "sem_permissao", "sem_credito"];

function estadoDoErro(codigo: CodigoErroVoz | null): string {
  if (codigo && ERROS_DE_CHAVE.includes(codigo)) return "Chave recusada";
  if (codigo === "sem_acesso") return "Sem acesso";
  if (codigo === "cifra_indisponivel" || codigo === "erro_ao_gravar") return "Não guardou";
  return "Não validou";
}

function corrigirDoErro(codigo: CodigoErroVoz | null): string {
  if (codigo && ERROS_DE_CHAVE.includes(codigo)) return "Colar outra chave";
  return "Voltar";
}

function avisoDoErro(codigo: CodigoErroVoz | null): string {
  if (codigo && ERROS_DE_CHAVE.includes(codigo)) return "Cole uma chave nova e valide de novo.";
  if (codigo === "sem_acesso") return "Só o admin pode configurar a Janete.";
  return "Valide de novo em instantes.";
}

/**
 * Etapa 4 · Voz (spec da voz, P4 a P7): o mesmo cartão do Cérebro, com um provedor só, a
 * ElevenLabs. "Validar chave" confere a chave na ElevenLabs e a grava cifrada (salvarChaveIA, no
 * servidor, com `finalidade: "voz"` e o modelo vazio, que se escolhe na feature de uso). Do sucesso
 * fica só o `ultimos4`; a chave fica só no `<input>` (não controlado) e o estado guarda o tamanho.
 * A voz é opcional: "Fazer depois" segue sem gravar. O cartão nasce do símbolo que veio do
 * despertar; no "Próximo", a Janete pousa sobre o check e a conversa a leva ao avatar.
 *
 * No "Chave aceita" aparece a lista das vozes da conta (spec do uso da voz, P17 e C4). Escolher só
 * marca a voz (as setas também escolhem, e gravar a cada seta seria uma gravação por voz); o
 * "Próximo" grava a voz marcada, se ela mudou, com escolherVoz e só depois voa. Se gravar falhar,
 * o erro aparece no bloco e a etapa não avança. Sem voz marcada, o "Próximo" segue sem gravar.
 */
export function EtapaVoz({ avancar }: PropsEtapa) {
  const { estado, definirVoz, irPara } = useOnboarding();
  const dados = useDadosOnboarding();
  const voo = useVooJanete();
  const vooRef = useRef(voo);
  vooRef.current = voo;
  const { anunciar } = usePalco();
  const { depois, focar } = useDepois();

  // quem volta com a chave (estado da aba) começa no ok
  const inicial = useRef(estado.voz).current;
  const jaValidada = !!inicial.ultimos4;
  const [tamanhoChave, setTamanhoChave] = useState(0);
  const [erroChave, setErroChave] = useState<string | null>(null);
  const [verChave, setVerChave] = useState(false);
  const [ultimos4, setUltimos4] = useState<string | null>(jaValidada ? inicial.ultimos4 : null);
  const [erro, setErro] = useState<ErroVozTela | null>(null);
  const [aviso, setAviso] = useState<{ titulo: string; texto: string } | null>(null);
  // "Próximo": `saindo` desde o clique, até a etapa avançar
  const [saindo, setSaindo] = useState(false);
  // a trava síncrona do voo: o `saindo` só chega no próximo render, e um clique repetido (Enter
  // segurado) antes dele gravaria a voz e avançaria de novo
  const saiuRef = useRef(false);
  const val = useValidacao(GIRO_IA_MS, jaValidada ? "ok" : "form");
  const fase = val.fase;

  // a lista de vozes: busca uma vez quando a chave está aceita; fora do ok, é esquecida (parada)
  const lista = useListaVozes(fase === "ok" ? dados.listarVozes : null);
  // a voz marcada na tela (rascunho); nula = a atual que a lista trouxe
  const [marcada, setMarcada] = useState<string | null>(null);
  // a voz que o "Próximo" está gravando, e a falha da gravação
  const [gravando, setGravando] = useState<string | null>(null);
  const gravandoRef = useRef(false);
  const [erroVoz, setErroVoz] = useState<ErroVozEscolhida | null>(null);
  const atual = lista.estado.k === "pronta" ? lista.estado.atual : null;
  const vozMarcada = marcada ?? atual?.id ?? null;

  // chegada do despertar: o cartão espera invisível (mas medido) o símbolo pousar no topo dele
  const chegouVoando = useRef(voo.ativo).current;
  const [entrada, setEntrada] = useState<EntradaCartao>(() => (chegouVoando && !movimentoReduzido() ? "espera" : null));

  // para onde o foco vai quando o formulário reabre
  const alvoFoco = useRef<string | null>(null);
  // "Fazer depois" já saiu: um segundo clique não avança de novo
  const pulou = useRef(false);
  const montado = useRef(true);
  useEffect(() => {
    // Religa na (re)montagem: em desenvolvimento o React monta duas vezes, e sem isto o marcador
    // ficava desligado para sempre e o "Próximo" nunca avançava.
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const validando = FASES_PALCO.includes(fase);
  // na chegada o cartão nasce do símbolo: a marca da barra só volta no fim da passagem
  useJaneteNoPalco(validando || entrada !== null);

  /** Para onde vai o foco quando a passagem termina: o campo, ou a ação do ok (já validada). */
  const focoDaChegada = () => (jaValidada ? "val-pri" : ID_CHAVE_VOZ);

  /* ---------- chegada do despertar (como a do login na etapa WhatsApp) ---------- */
  useEffect(() => {
    if (!chegouVoando) {
      // voltou já validada (estado da aba): o foco vai para a ação do resultado
      if (jaValidada) focar("val-pri");
      return;
    }
    if (movimentoReduzido()) {
      vooRef.current.soltar();
      focar(focoDaChegada());
      return;
    }
    const ts: Array<ReturnType<typeof setTimeout>> = [];
    let vivo = true;
    // o cartão nasce do símbolo: 180 ms depois de o voo chegar, e a entrada termina 780 ms depois
    const nascer = (aposMs: number) => {
      ts.push(
        setTimeout(() => {
          setEntrada("nascendo");
          vooRef.current.soltar({ desvanecer: true });
        }, aposMs),
      );
      ts.push(
        setTimeout(() => {
          setEntrada(null);
          focarAgora(focoDaChegada());
        }, aposMs + NASCE_MS),
      );
    };
    ts.push(
      setTimeout(() => {
        // o alvo é o círculo de onde o cartão nasce (#nasce-mira); mede só depois de a página
        // parar de rolar, para o símbolo não pousar fora dele
        void rolarAteEMedir("nasce-mira").then((ponto) => {
          if (!vivo) return;
          if (!ponto) {
            nascer(0);
            return;
          }
          void vooRef.current.voar({ ...ponto, tamanho: 96 }, { duracaoMs: VOO_MS });
          nascer(NASCE_APOS_MS);
        });
      }, 60),
    );
    return () => {
      vivo = false;
      ts.forEach(clearTimeout);
    };
    // só na montagem
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- foco depois de cada transição ---------- */
  const faseAnterior = useRef<Fase>(fase);
  useEffect(() => {
    const antes = faseAnterior.current;
    faseAnterior.current = fase;
    if (antes === fase) return;
    if (fase === "ok" || fase === "erro") {
      focar("val-pri", { rolar: true });
      return;
    }
    if (fase === "form" && (antes === "reabrindo" || antes === "ok" || antes === "erro")) {
      const alvo = alvoFoco.current;
      alvoFoco.current = null;
      focar(alvo ?? ID_CHAVE_VOZ, { rolar: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fase]);

  /* ---------- anúncios ---------- */
  useEffect(() => {
    if (fase === "verificando") anunciar("Validando a chave da ElevenLabs…");
    else if (fase === "ok" && ultimos4) anunciar("Chave aceita. A voz da Janete está conectada.");
    else if (fase === "erro" && erro) anunciar(`${estadoDoErro(erro.codigo)}. ${erro.titulo}`);
  }, [anunciar, erro, fase, ultimos4]);

  /* ---------- a chave ---------- */

  /** Apaga a chave do campo (e da memória: o estado só tem o tamanho). */
  const apagarChave = () => {
    limparCampo(ID_CHAVE_VOZ);
    setTamanhoChave(0);
  };

  const emCurso = val.preparando || fase === "fechando" || fase === "verificando";
  const bloqueado = tamanhoChave < CHAVE_MINIMA || fase !== "form" || saindo;

  /* ---------- validação ---------- */
  const validar = () => {
    if (saindo) return;
    const k = lerCampo(ID_CHAVE_VOZ).trim();
    if (k.length < CHAVE_MINIMA) return;
    setAviso(null);
    setErroChave(null);
    setVerChave(false);
    // Confere na ElevenLabs e grava de uma vez (salvarChaveIA). O modelo vazio quer dizer "ainda não
    // escolhido": a voz e o modelo de fala se escolhem na feature de uso.
    const entrada: EntradaSalvarChaveIA = { finalidade: "voz", provedor: "elevenlabs", modelo: "", chave: k };
    val.validar<ResultadoSalvarChaveIA>({
      chamar: () => dados.salvarChaveIA(entrada),
      concluir: (d: Desfecho<ResultadoSalvarChaveIA>) => {
        if (d.tipo === "resposta" && d.valor.ok) {
          setUltimos4(d.valor.ultimos4);
          definirVoz({ ultimos4: d.valor.ultimos4, pulou: false });
          // a mesma chave vira a da escuta, se ela estiver livre (spec da escuta com a ElevenLabs, T8 e
          // P8): a cópia é no servidor, de melhor esforço, sem mensagem e sem esperar. Uma falha não
          // muda a etapa: a escuta segue pela voz.
          void dados.usarChaveElevenLabs({ para: "transcricao", seLivre: true }).catch(() => undefined);
          // sucesso: a chave sai da tela e da memória do componente
          apagarChave();
          setErro(null);
          return "ok";
        }
        if (d.tipo === "sem_sessao") {
          setErro({ codigo: null, ...separarMensagem(MENSAGEM_SEM_SESSAO), semSessao: true });
          return "erro";
        }
        const codigo = d.tipo === "resposta" && !d.valor.ok ? d.valor.erro : null;
        const mensagem = d.tipo === "resposta" && !d.valor.ok ? mensagemDoResultado(d.valor) : MENSAGEM_SEM_RESPOSTA;
        setErro({ codigo, ...separarMensagem(mensagem) });
        return "erro";
      },
    });
  };

  const corrigir = () => {
    if (saindo) return;
    const e = erro;
    if (e?.semSessao) {
      irParaEntrar();
      return;
    }
    const codigo = e?.codigo ?? null;
    val.reabrir(() => {
      if (e) setAviso({ titulo: e.titulo, texto: avisoDoErro(codigo) });
      if (codigo && ERROS_DE_CHAVE.includes(codigo)) {
        apagarChave();
        setErroChave(e ? e.texto || e.titulo : null);
      }
      alvoFoco.current = ID_CHAVE_VOZ;
    });
  };

  const trocarChave = () => {
    // o "Próximo" já saiu (ou grava a voz): a chave validada fica
    if (saindo || saiuRef.current || gravandoRef.current) return;
    val.reabrir(() => {
      apagarChave();
      setErroChave(null);
      setUltimos4(null);
      setAviso(null);
      // a lista sai com o ok (fica parada, e a prévia para); a voz marcada é esquecida
      setMarcada(null);
      setErroVoz(null);
      definirVoz({ ultimos4: null });
      alvoFoco.current = ID_CHAVE_VOZ;
    });
  };

  /** A voz que o "Próximo" grava: a marcada, se está na lista e não é a que já estava gravada. */
  const vozAGravar = () => {
    if (lista.estado.k !== "pronta" || !marcada || marcada === atual?.id) return null;
    return lista.estado.vozes.find((v) => v.id === marcada) ?? null;
  };

  // 4 → 5: grava a voz marcada (se mudou) e só depois voa
  const proximo = () => {
    if (saindo || saiuRef.current || gravandoRef.current || fase !== "ok") return;
    const voz = vozAGravar();
    if (!voz) {
      voar();
      return;
    }
    gravandoRef.current = true;
    setGravando(voz.id);
    setErroVoz(null);
    const falhou = (mensagem: string, semSessao = false) => {
      gravandoRef.current = false;
      setGravando(null);
      setErroVoz({ ...separarMensagem(mensagem), semSessao });
      anunciar(`Não salvou a voz. ${separarMensagem(mensagem).titulo}`);
    };
    dados.escolherVoz({ vozId: voz.id }).then(
      (r) => {
        if (!montado.current) return;
        if (r && typeof r === "object" && r.ok) {
          gravandoRef.current = false;
          setGravando(null);
          anunciar(`Voz escolhida: ${r.voz.nome}.`);
          voar();
          return;
        }
        if (r && typeof r === "object" && !r.ok) {
          const m = mensagemDoResultado(r);
          falhou(m === MENSAGEM_SEM_RESPOSTA ? MENSAGEM_VOZ_SEM_RESPOSTA : m);
          return;
        }
        falhou(MENSAGEM_VOZ_SEM_RESPOSTA);
      },
      async () => {
        // a função caiu antes de responder: a rede, ou a sessão que terminou
        const semSessao = await sessaoTerminou();
        if (!montado.current) return;
        if (semSessao) falhou(MENSAGEM_SEM_SESSAO, true);
        else falhou(MENSAGEM_VOZ_SEM_RESPOSTA);
      },
    );
  };

  // a Janete aparece sobre o check e fica em trânsito; a conversa a leva ao avatar
  const voar = () => {
    if (saiuRef.current) return;
    saiuRef.current = true;
    if (movimentoReduzido()) {
      avancar();
      return;
    }
    setSaindo(true);
    // mede o check só com o disco inteiro na vista, abaixo da barra (a mira já desconta a barra), e
    // com a página parada
    const seguir = () => {
      if (!montado.current) return;
      const ponto = medirJanete("val-disco");
      if (ponto) vooRef.current.pousar(ponto, "acordada");
      depois(() => {
        if (montado.current) avancar();
      }, POUSO_MS);
    };
    void rolarAteEMedir("disco-mira", { bloco: "center" }).then(seguir, seguir);
  };

  // "Fazer depois": sem chave, sem voo; a conversa abre direto
  const fazerDepois = () => {
    if (pulou.current || emCurso || saindo) return;
    pulou.current = true;
    definirVoz({ pulou: true });
    avancar();
  };

  /* ---------- tela ---------- */
  const cerebro = estado.cerebro;
  const motorCerebro = cerebro.ultimos4 ? acharMotor(cerebro.provedor) : null;
  const cerebroFeito = motorCerebro ? `Conectado via ${motorCerebro.nome}` : "Ainda não conectado";

  const palco = (
    <PalcoValidacao
      fase={fase}
      faseAntes={val.faseAntes}
      logo={LOGO.elevenlabs}
      logoAlt="ElevenLabs"
      passos={PASSOS}
      passo={val.passo}
      ok={
        <BlocoOk
          estado="Chave aceita"
          titulo="A voz da Janete está conectada."
          mono={false}
          detalhe={
            <>
              chave terminada em <span className={s.mono}>{ultimos4}</span>
            </>
          }
          linha={
            <p className={cx(s.estadoLinha, s.sobe, s.d3)}>
              <Icone d={IC.cadeado} tamanho="p" />
              <span>A chave fica guardada com segurança e nunca é mostrada de novo.</span>
            </p>
          }
          extra={
            <div className={cx(s.okExtra, s.sobe, s.d3)} role="group" aria-labelledby="voz-lista-titulo">
              <p id="voz-lista-titulo" className={s.okExtraTitulo}>
                Escolha a voz da Janete
              </p>
              {erroVoz && <AvisoErro titulo={erroVoz.titulo} texto={erroVoz.texto} />}
              {erroVoz?.semSessao && (
                <BotaoCompacto variante="contorno" aoClicar={irParaEntrar}>
                  Entrar de novo
                </BotaoCompacto>
              )}
              <ListaDeVozes
                estado={lista.estado}
                valor={vozMarcada}
                aoMudar={(id) => {
                  setMarcada(id);
                  setErroVoz(null);
                }}
                aoRecarregar={lista.recarregar}
                ocupada={gravando}
                desligado={saindo}
                rotulo="Voz da Janete"
                idBase="voz-opcao"
              />
            </div>
          }
          acaoPrincipal="Próximo"
          aoPrincipal={proximo}
          acaoSecundaria="Trocar chave"
          aoSecundaria={trocarChave}
        />
      }
      erro={
        erro
          ? {
              estado: estadoDoErro(erro.codigo),
              titulo: erro.titulo,
              texto: erro.texto,
              corrigirTexto: erro.semSessao ? "Entrar de novo" : corrigirDoErro(erro.codigo),
              aoCorrigir: corrigir,
              aoTentarDeNovo: validar,
            }
          : null
      }
    />
  );

  return (
    <CartaoLista
      etapa="voz"
      topo={<p className={s.olho}>A voz da Janete</p>}
      titulo="Conecte a ElevenLabs"
      subtitulo="Com ela, a Janete escuta os áudios dos leads e responde por áudio. Dá para trocar depois na Configuração."
      fase={fase}
      validando={validando}
      entrada={entrada}
      saindo={saindo}
      preparando={val.preparando}
      palco={palco}
    >
      <div className={s.linhaResumo}>
        <span className={cx(s.feitoGlifo, motorCerebro && s.ok)} aria-hidden="true">
          <Icone d={motorCerebro ? IC.ok : IC.pendente} tamanho="p" />
        </span>
        <span className={s.linhaTexto}>
          <span className={s.meta}>Cérebro</span>
          <span className={s.resumoNome}>{cerebroFeito}</span>
        </span>
        <Botao variante="discreto" className={s.btnC} onClick={() => irPara("cerebro")}>
          {motorCerebro ? "Alterar" : "Conectar"}
        </Botao>
      </div>
      <div className={s.painel} role="group" aria-label="ElevenLabs">
        <PainelCab
          inicio={<LogoTile logo={LOGO.elevenlabs} alt="ElevenLabs" />}
          nome="ElevenLabs"
          frase="Vozes realistas e transcrição de áudio, com uma chave só."
        />
        {aviso && <AvisoErro titulo={aviso.titulo} texto={aviso.texto} />}
        <Campo
          id={ID_CHAVE_VOZ}
          rotulo="Chave de API da ElevenLabs"
          type={verChave ? "text" : "password"}
          onChange={(ev) => {
            setTamanhoChave(ev.target.value.trim().length);
            setErroChave(null);
          }}
          onKeyDown={(ev) => {
            if (ev.key !== "Enter") return;
            ev.preventDefault();
            if (!bloqueado) validar();
          }}
          placeholder="Cole a chave aqui"
          autoComplete="off"
          spellCheck={false}
          style={{ fontFamily: "var(--sb-fonte-mono)" }}
          erro={erroChave ?? undefined}
          dica="Depois de validada, a chave fica guardada com segurança e nunca é mostrada de novo."
          sufixo={
            <button
              type="button"
              className={s.olhar}
              aria-label={verChave ? "Ocultar chave" : "Mostrar chave"}
              onClick={() => setVerChave((v) => !v)}
            >
              {verChave ? "Ocultar" : "Mostrar"}
            </button>
          }
        />
        <p className={s.ajuda}>
          Na ElevenLabs, crie a chave em Developers → API Keys e ligue os acessos User, Text to Speech, Speech to Text e
          Voices (leitura).
        </p>
        <div className={s.painelPe}>
          <Botao disabled={bloqueado} onClick={validar} iconeDepois={<Icone d={IC.seta} />}>
            Validar chave
          </Botao>
          <Botao variante="discreto" disabled={emCurso || saindo} onClick={fazerDepois}>
            Fazer depois
          </Botao>
        </div>
      </div>
    </CartaoLista>
  );
}
