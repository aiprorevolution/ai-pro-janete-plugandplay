import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { movimentoReduzido } from "@/components/janete/VooJanete";
import { Botao } from "@/components/aipro";
import type { Classes } from "@/components/aipro/cx";
import { PassoQr } from "@/features/onboarding/conexao/qr/PassoQr";
import { useLeituraQr } from "@/features/onboarding/conexao/qr/useLeituraQr";
import { IC } from "@/features/onboarding/lista/dados";
import { useDepois } from "@/features/onboarding/lista";
import { ehGatewayQr } from "@/features/servidor/qr-conexao";
import type { ModoVoz } from "@/features/servidor/vozes-tipos";

import { VistaArea, idTituloArea } from "../AreaVazia";
import {
  useDadosConfiguracao,
  type ConexaoConfiguracao,
  type DadosConfiguracao,
  type FalhaConfiguracao,
} from "../dados/configuracao";
import { Carregando, ErroLeitura } from "../dados/estados";
import { useDados } from "../dados/ProvedorDados";
import type { ConfiguracaoDados } from "../dados/tipos";
import type { ChaveIA } from "../exemplo";
import { usePapel } from "../papel";
import estilosCfg from "./Configuracao.module.css";
import { CartaoCerebro } from "./CartaoCerebro";
import { CartaoEscuta } from "./CartaoEscuta";
import { CartaoRitmo, mudarRitmo, type Ritmo } from "./CartaoRitmo";
import { CartaoVoz } from "./CartaoVoz";
import { CartaoWhats, type ConsertoW, type TesteW } from "./CartaoWhats";
import { CAMPO_TOKEN, GATEWAY_QR, MOSTRAR_QR, comMinimo, respostaQr, type GatewayCfg } from "./dados";
import { c } from "./estilos";
import { Fluxo, type AberturaFluxo, type TipoFluxo } from "./Fluxo";
import { copiarQuandoChegar } from "../equipe/copiar";
import { lerCerebro, lerEscuta, lerMotor, lerVoz, lerWhats, motorParado, soAtrasada } from "./leitura";
import { ICX, Ic } from "./pecas";
import {
  NOS_DO_FIO,
  SEM_TESTE,
  Saude,
  ULTIMO_NO,
  avisoMotor,
  noDaVoz,
  textosSaude,
  type EstadoNo,
  type EstadoSeg,
  type HeroJanete,
  type Peca,
  type Teste,
} from "./Saude";
import { textoFalhaAcao } from "./textos";

/** As classes do aviso do atendente (o estilos.ts não é desta tela: tipadas aqui). */
const ca = estilosCfg as Classes<"cfSoAdmin" | "cfSoAdminTexto">;

type Cartao = "whats" | "cerebro" | "escuta" | "voz" | "ritmo";
type Realce = { cartao: Cartao; tipo: "flash" | "nasce" } | null;
type Toast = { texto: string; tom: "ok" | "info"; id: number } | null;
type Dialogo = "desconectar" | "remover-escuta" | "remover-voz" | null;

/** O painel de cada gateway, para o webhook que fica nele depois do Desconectar (decisão 4 das lacunas). */
const PAINEL_WEBHOOK: Record<GatewayCfg, string> = {
  meta: "da Meta",
  zapi: "da Z-API",
  evolution: "da Evolution",
  zernio: "da Zernio",
};
/** Meta e Z-API não desligam o webhook pela API: o diálogo lembra antes de confirmar. */
const lembreteWebhook = (g: GatewayCfg) => `Tire também o webhook no painel ${PAINEL_WEBHOOK[g]}.`;

/** A ordem dos cartões à direita (a do briefing) e o cartão de cada troca. */
const ORDEM_CARTOES: Record<Cartao, number> = { whats: 0, cerebro: 1, escuta: 2, voz: 3, ritmo: 4 };
const CARTAO_DO_FLUXO: Record<TipoFluxo, Cartao> = {
  whats: "whats",
  chave: "cerebro",
  modelo: "cerebro",
  motor: "cerebro",
  escuta: "escuta",
  voz: "voz",
  vozes: "voz",
};

/** De quanto em quanto tempo o relógio da tela anda (a Saúde confere o atraso da Janete contra ele). */
const RELOGIO_MS = 30_000;

/**
 * O conserto (ou o "Testar") lido pelo celular de outro número: a frase do servidor (que diz se a
 * Janete desconectou o celular); sem ela, os 2 números; sem eles, a frase neutra.
 */
function textoNumeroDiferente(r: FalhaConfiguracao): string {
  const m = r.mensagem?.trim();
  if (m) return m;
  if (r.numeroConectado && r.numeroSalvo)
    return `Este celular é do ${r.numeroConectado}, não do ${r.numeroSalvo} desta conexão. Leia o QR code com o celular do ${r.numeroSalvo}.`;
  return textoFalhaAcao("numero_diferente");
}

function telaEstreita(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 899px)").matches;
}

/**
 * A Configuração é só do admin (spec, bloco 1, item 4, confirmado em 30/10): para o atendente ela some
 * do menu, do dock, dos atalhos e do tour, e a rota já o leva embora. Se ele chegar à tela mesmo assim,
 * vê só um aviso curto com o caminho de volta para o Chat. O papel vem da casca (o Eu, no banco).
 * Trocar o papel desmonta a tela do admin: o fluxo, a confirmação e a conferência abertos somem.
 */
export function TelaConfiguracao() {
  const { papel } = usePapel();
  return papel === "admin" ? <TelaConfiguracaoAdmin /> : <AvisoSoAdmin />;
}

/** O que o atendente vê em /app/configuracao: o título da área, uma frase e "Ir para o Chat". */
function AvisoSoAdmin() {
  // Sem roteador (a tela montada sozinha num teste), o botão só não navega.
  const router = useRouter({ warn: false });
  const irParaChat = () => {
    if (!router) return;
    // A promessa da navegação não garante que o Chat já montou: o foco espera um pouco, como o
    // `focar` do Layout (60 ms).
    void router.navigate({ to: "/app/chat" }).then(() => {
      setTimeout(() => document.getElementById(idTituloArea("chat"))?.focus({ preventScroll: true }), 60);
    });
  };
  return (
    <VistaArea area="configuracao">
      <div className={ca.cfSoAdmin} data-papel="atendente">
        <p className={ca.cfSoAdminTexto}>Só o admin vê a Configuração.</p>
        <Botao variante="principal" onClick={irParaChat}>
          Ir para o Chat
        </Botao>
      </div>
    </VistaArea>
  );
}

/**
 * Lê a conexão, as chaves e a configuração pela camada de dados (dados/configuracao.ts) e mostra os
 * 3 estados: carregando (os ossos dos cartões), erro (com "Tentar de novo") e a tela.
 */
function TelaConfiguracaoAdmin() {
  const dados = useDadosConfiguracao();
  const leituras = [dados.conexao, dados.chaves, dados.configuracao];
  // um erro só toma a tela quando ainda não há dado (a releitura de fundo que falha não apaga a tela)
  const falhou = leituras.find((l) => l.erro && l.dados === undefined);
  if (falhou) {
    return (
      <VistaArea area="configuracao">
        <div className={c.cfRaiz} data-papel="admin" data-estado="erro">
          <ErroLeitura
            erro={falhou.erro}
            titulo="Não deu para carregar a Configuração"
            tentarDeNovo={() => {
              for (const l of leituras) if (l.erro) l.tentarDeNovo();
            }}
          />
        </div>
      </VistaArea>
    );
  }
  const conexao = dados.conexao.dados;
  const chaves = dados.chaves.dados;
  const configuracao = dados.configuracao.dados;
  if (!conexao || !chaves || !configuracao) {
    return (
      <VistaArea area="configuracao">
        <div className={c.cfRaiz} data-papel="admin" data-estado="carregando">
          <Carregando forma="cartao" quantos={5} rotulo="Carregando a Configuração" />
        </div>
      </VistaArea>
    );
  }
  return <PainelConfiguracao dados={dados} conexaoCfg={conexao} chaves={chaves} configuracao={configuracao} />;
}

interface PropsPainel {
  dados: DadosConfiguracao;
  conexaoCfg: ConexaoConfiguracao;
  chaves: ChaveIA[];
  configuracao: ConfiguracaoDados;
}

/**
 * A Configuração 3 · O caminho da mensagem (docs/mockups/plataforma/Configuracao-3.dc.html). À
 * esquerda, a saúde da Janete e o fio das 5 peças na ordem da mensagem (a voz por último, e nunca em
 * erro: a falha da fala vira texto, P13 do uso da voz); à direita, um cartão por peça (WhatsApp,
 * cérebro, escuta, voz e ritmo). Trocar reabre os cartões e a validação do onboarding. No banco,
 * cada ação é uma função de servidor da mensageria (só admin); no exemplo, a memória.
 */
function PainelConfiguracao({ dados, conexaoCfg, chaves, configuracao }: PropsPainel) {
  const { modo, acoes, euId } = dados;
  const demo = modo === "exemplo";
  const admin = true;
  // Sem roteador (a tela montada sozinha num teste), o conserto do onboarding só não aparece.
  const router = useRouter({ warn: false });
  const { depois, focar } = useDepois();
  const mov = !movimentoReduzido();

  // o relógio anda sozinho: a Saúde percebe a Janete atrasada sem ninguém mexer na tela
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), RELOGIO_MS);
    return () => clearInterval(t);
  }, []);
  const vivo = useRef(true);
  useEffect(() => {
    // religa na (re)montagem: no StrictMode o React monta, desmonta e monta de novo
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  // "Você desconectou" só quando quem desligou foi quem lê (o ator vem do evento ou, quando o servidor
  // desligou, da auditoria). Sem saber quem foi, a frase sai neutra, para não dizer "você" a outro admin.
  const desligada = conexaoCfg.desligada;
  const voce = !!desligada && desligada.ator_membro_id !== null && desligada.ator_membro_id === euId;
  const w = lerWhats(conexaoCfg.conexao, voce);
  const cer = lerCerebro({ chaves }, admin);
  const esc = lerEscuta({ chaves }, admin);
  // o modo que acabou de ser gravado vale na tela até a releitura da configuração chegar (no banco)
  const [modoGravado, setModoGravado] = useState<ModoVoz | null>(null);
  const [salvandoModo, setSalvandoModo] = useState<ModoVoz | null>(null);
  const vozLida = lerVoz({ chaves, configuracao }, admin);
  if (modoGravado && vozLida.modo === modoGravado) setModoGravado(null);
  const voz = modoGravado ? { ...vozLida, modo: modoGravado } : vozLida;
  // com o onboarding aberto, a Janete não atende (pegar_rodadas vazio, decisão 2): a Saúde não fica
  // verde. O motor (motor_pendencias) vem da camada, já validado; no exemplo, não há motor.
  const pendencias = useDados().useMotor();
  const andamento = lerMotor(
    pendencias,
    agora,
    modo === "banco",
    configuracao.onboarding_concluido_em === null,
    configuracao.worker_visto_em,
  );
  const parouMotor = motorParado(andamento);
  const salvo: Ritmo = { espera: configuracao.espera_lote_s, teto: configuracao.espera_lote_max_s };

  const [teste, setTeste] = useState<Teste>(SEM_TESTE);
  const rodadaTeste = useRef(0);
  const [testeW, setTesteW] = useState<TesteW>("idle");
  const [testeC, setTesteC] = useState(false);
  const [erroTesteC, setErroTesteC] = useState<string | null>(null);
  const [hero, setHero] = useState<HeroJanete>(null);
  const [simCard, setSimCard] = useState(false);
  const [fluxo, setFluxo] = useState<AberturaFluxo | null>(null);
  const seqFluxo = useRef(0);
  const travadoRef = useRef(false);
  const [realce, setRealce] = useState<Realce>(null);
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [ocupado, setOcupado] = useState<"desconectar" | "remover-escuta" | "remover-voz" | null>(null);
  /** O Desconectar não desligou o webhook no provedor: o lembrete fica no cartão do WhatsApp desconectado. */
  const [webhookFicou, setWebhookFicou] = useState<GatewayCfg | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqToast = useRef(0);
  const [rasc, setRasc] = useState<Ritmo>(salvo);
  const [salvando, setSalvando] = useState(false);
  const [verWebhook, setVerWebhook] = useState(false);
  const [verVerify, setVerVerify] = useState(false);
  const [verify, setVerify] = useState<{ conexaoId: string; valor: string } | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [verTempo, setVerTempo] = useState(false);
  /** O QR code aberto no cartão do WhatsApp (o conserto do número caído na Z-API e na Evolution). */
  const [qrW, setQrW] = useState(false);
  /**
   * Por que o QR voltou ao cartão: o conserto foi lido pelo celular de outro número (spec-qr-whatsapp,
   * seção 8, decisão 4). Some quando o QR fecha ou quando a conferência dá certo.
   */
  const [avisoQrW, setAvisoQrW] = useState<string | null>(null);
  /**
   * A conferência pediu o QR de volta (numero_diferente, o celular saiu), mas a releitura da conexão
   * ainda não trouxe o "desconectada" que o servidor gravou: o QR abre quando ela chegar. Guarda a
   * frase do aviso.
   */
  const reabrirQrW = useRef<string | null>(null);
  /** Quantas vezes seguidas o conserto reabriu o QR sozinho: a partir de 2, só avisa (nunca um laço). */
  const reabriuQrW = useRef(0);
  /** Uma conferência do WhatsApp em curso (o aoConectar e o fechamento do QR podem pedir juntos). */
  const conferindoW = useRef(false);
  if (!qrW && avisoQrW !== null) setAvisoQrW(null);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  /* ---------- apoio ---------- */

  const avisar = useCallback((texto: string, tom: "ok" | "info" = "ok") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    seqToast.current += 1;
    setToast({ texto, tom, id: seqToast.current });
    toastTimer.current = setTimeout(() => {
      toastTimer.current = null;
      setToast(null);
    }, 4500);
  }, []);

  const mostrarHero = useCallback(
    (h: HeroJanete) => {
      setHero(h);
      if (h === "check") depois(() => setHero((atual) => (atual === "check" ? null : atual)), 1900);
    },
    [depois],
  );

  const realcar = useCallback(
    (cartao: Cartao, tipo: "flash" | "nasce") => {
      setRealce({ cartao, tipo });
      depois(() => setRealce((r) => (r && r.cartao === cartao && r.tipo === tipo ? null : r)), tipo === "nasce" ? 1100 : 1500);
    },
    [depois],
  );

  const rolarAte = (cartao: Cartao, bloco: ScrollLogicalPosition = "start", ja = false) => {
    const el = typeof document !== "undefined" ? document.getElementById(`cfg-card-${cartao}`) : null;
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: bloco, behavior: mov && !ja ? "smooth" : "auto" });
  };

  const zerarTeste = () => {
    rodadaTeste.current += 1;
    setTeste(SEM_TESTE);
  };

  const testandoAlgo = teste.rodando || testeW === "testando" || testeC || ocupado !== null;

  /* ---------- trocar ---------- */

  const abrirFluxo = (tipo: TipoFluxo, opcoes: { gateway?: GatewayCfg; soCampo?: string | undefined } = {}) => {
    if (!admin || (fluxo && travadoRef.current) || testandoAlgo) return;
    seqFluxo.current += 1;
    setFluxo({ tipo, gateway: opcoes.gateway, soCampo: opcoes.soCampo, telaCheia: telaEstreita(), id: seqFluxo.current });
    setQrW(false);
    setDialogo(null);
    setRealce(null);
    setCopiado(null);
    setHero((h) => (h === "carregando" ? null : h));
  };

  const fecharFluxo = (efeito?: "nasce") => {
    if (!fluxo) return;
    const alvo = CARTAO_DO_FLUXO[fluxo.tipo];
    const eraCheia = fluxo.telaCheia;
    setFluxo(null);
    travadoRef.current = false;
    setHero((h) => (h === "carregando" ? null : h));
    // a troca valeu: o cartão volta desdobrando (a conferência anterior já foi zerada em trocaAplicada)
    if (efeito) realcar(alvo, efeito);
    depois(() => rolarAte(alvo, eraCheia ? "start" : "nearest", eraCheia), 20);
    focar(`cfg-h-${alvo}`, { atrasoMs: mov ? 260 : 0 });
  };

  // a troca foi gravada (antes de o fluxo fechar): a conferência anterior deixa de valer, feche como fechar
  const trocaAplicada = () => {
    zerarTeste();
    setTesteW("idle");
    setErroTesteC(null);
    setVerify(null);
    setVerVerify(false);
  };

  /* ---------- o fio: ir até a peça ---------- */

  const irPeca = (peca: Peca) => {
    if (fluxo && travadoRef.current) return;
    const ir = () => {
      rolarAte(peca);
      realcar(peca, "flash");
      focar(`cfg-h-${peca}`, { atrasoMs: mov ? 360 : 0 });
    };
    if (fluxo) {
      fecharFluxo();
      depois(ir, 80);
    } else ir();
  };

  /* ---------- conferir tudo: uma peça de cada vez, sem falar com nenhum lead ---------- */

  type Resposta = { no: EstadoNo; motivo?: string | undefined };

  /**
   * O resultado de cada peça. No banco, a conferência grátis de verdade (decisão 10b), em paralelo:
   * a conexão guardada (conferirConexao) e as chaves guardadas (revalidarChaveIA, que na voz também
   * confere a voz escolhida, P12); o ritmo confere o atraso da Janete (motor_pendencias). No exemplo, o
   * que a tela já sabe. A voz nunca para a conferência: sem chave é neutra, e a falha é atenção.
   */
  function respostasDaConferencia(): Promise<Resposta>[] {
    if (demo) {
      return [w.ok ? "ok" : "erro", esc.ok ? "ok" : "atencao", "ok", cer.ok ? "ok" : "erro", noDaVoz(voz)].map((no) =>
        Promise.resolve({ no: no as EstadoNo }),
      );
    }
    const curto = w.prov?.curto ?? "";
    const pWhats: Promise<Resposta> = w.prov
      ? acoes.conferirConexao().then((r) =>
          r.ok ? { no: "ok" } : { no: "erro", motivo: `A ${curto} não confirmou o número: ${textoFalhaAcao(r.erro, r.mensagem)}` },
        )
      : Promise.resolve({ no: "erro", motivo: "Nenhum WhatsApp conectado. As mensagens dos leads não chegam até a Janete." });
    const pCerebro: Promise<Resposta> = cer.chave
      ? acoes.revalidarChave("resposta").then((r) =>
          r.ok ? { no: "ok" } : { no: "erro", motivo: `O cérebro não respondeu: ${textoFalhaAcao(r.erro, r.mensagem)}` },
        )
      : Promise.resolve({ no: "erro", motivo: "A Janete está sem chave de IA." });
    // a chave da voz é conferida uma vez só: o nó da voz e, quando ela transcreve, o da escuta
    const conferenciaVoz = voz.chave ? acoes.revalidarChave("voz") : null;
    const pVoz: Promise<Resposta> = conferenciaVoz
      ? conferenciaVoz.then((r) => ({ no: voz.modo === "nunca" ? "desconhecido" : r.ok && r.voz === "ok" ? "ok" : "atencao" }))
      : Promise.resolve({ no: "desconhecido" });
    // na ordem do servidor: a chave só de áudio inválida é pulada (viaCerebro e viaVoz já contam isso)
    const pEscuta: Promise<Resposta> = esc.viaCerebro
      ? pCerebro.then((r) => ({ no: r.no === "ok" ? "ok" : "atencao" }))
      : esc.viaVoz && conferenciaVoz
        ? conferenciaVoz.then((r) => ({ no: r.ok ? "ok" : "atencao" }))
        : esc.chave
          ? acoes.revalidarChave("transcricao").then((r) => ({ no: r.ok ? "ok" : "atencao" }))
          : Promise.resolve({ no: "atencao" });
    const aw = avisoMotor(andamento);
    const pRitmo: Promise<Resposta> = Promise.resolve(aw ? { no: "erro", motivo: aw.sub } : { no: "ok" });
    return [pWhats, pEscuta, pRitmo, pCerebro, pVoz];
  }

  const testarTudo = () => {
    if (!admin || testandoAlgo || fluxo || qrW || salvandoModo) return;
    const respostas = respostasDaConferencia();
    const passoMs = mov ? 860 : 120;
    const id = ++rodadaTeste.current;
    const inicio: Teste = {
      rodando: true,
      nos: Array.from({ length: NOS_DO_FIO }, (_, i): EstadoNo => (i === 0 ? "ativo" : "")),
      segs: Array.from({ length: ULTIMO_NO }, (): EstadoSeg => ""),
      anda: -1,
      fim: null,
      onde: -1,
    };
    setTeste(inicio);
    setHero(null);
    const passo = (i: number, nosAntes: EstadoNo[], segsAntes: EstadoSeg[]) => {
      if (id !== rodadaTeste.current) return;
      void respostas[i]!.then((r) => {
        if (id !== rodadaTeste.current || !vivo.current) return;
        const nos = [...nosAntes];
        const segs = [...segsAntes];
        nos[i] = r.no;
        if (r.no === "erro") {
          for (let k = i; k < ULTIMO_NO; k++) segs[k] = "quebrado";
          setTeste({ rodando: false, nos, segs, anda: -1, fim: "erro", onde: i, motivo: r.motivo });
          focar("cfg-testar-tudo");
          return;
        }
        if (i === ULTIMO_NO) {
          setTeste({ rodando: false, nos, segs, anda: -1, fim: "ok", onde: -1 });
          mostrarHero("check");
          focar("cfg-testar-tudo");
          return;
        }
        segs[i] = "cheio";
        nos[i + 1] = "ativo";
        setTeste({ rodando: true, nos, segs, anda: i, fim: null, onde: -1 });
        // o ritmo é só configuração: o passo dele é curto
        depois(() => passo(i + 1, nos, segs), i + 1 === 2 ? Math.round(passoMs * 0.45) : passoMs);
      });
    };
    depois(() => passo(0, inicio.nos!, inicio.segs!), passoMs);
  };

  /* ---------- WhatsApp ---------- */

  // "Testar a conexão agora": a conferência grátis com os dados guardados (decisão 10b)
  const testarWhats = () => {
    if (!admin || testandoAlgo || !w.ok || !w.prov) return;
    const prov = w.prov;
    setTesteW("testando");
    void comMinimo(acoes.conferirConexao(), mov ? 1800 : 300).then((r) => {
      if (!vivo.current) return;
      if (!r.ok) {
        setTesteW("idle");
        // o celular de outro número (spec-qr-whatsapp, seção 8): a frase do servidor diz tudo
        // (desconectou ou não); o cartão vira o do número caído, com o QR
        avisar(
          r.erro === "numero_diferente"
            ? textoNumeroDiferente(r)
            : `A ${prov.curto} não confirmou a conexão. ${textoFalhaAcao(r.erro, r.mensagem)}`,
          "info",
        );
        focar("cfg-h-whats");
        return;
      }
      setTesteW("ok");
      avisar(`${prov.id === "meta" ? "A Meta" : `A ${prov.curto}`} respondeu. O WhatsApp está conectado.`);
      focar("cfg-testar-whats");
    });
  };

  // o QR volta ao cartão com o aviso de por que voltou (o conserto lido pelo celular de outro número)
  const abrirQrComAviso = (frase: string) => {
    setAvisoQrW(frase);
    setQrW(true);
    depois(() => rolarAte("whats"), 20);
    focar("cfg-qr-titulo", { atrasoMs: mov ? 360 : 0 });
  };

  // conexão salva que caiu: confere com os dados guardados, sem colar nada. Devolve se a conferência
  // começou (false quando outra coisa já está conferindo ou testando).
  const conferirWhats = (): boolean => {
    if (!admin || conferindoW.current || testeW === "testando" || fluxo || teste.rodando || !w.prov)
      return false;
    const prov = w.prov;
    conferindoW.current = true;
    setTesteW("testando");
    zerarTeste();
    mostrarHero("carregando");
    void comMinimo(acoes.conferirConexao({ falhar: simCard }), mov ? 2250 : 300).then((r) => {
      conferindoW.current = false;
      if (!vivo.current) return;
      if (!r.ok) {
        const qr = !!GATEWAY_QR[prov.id];
        setTesteW("idle");
        setHero(null);
        // lido pelo celular de outro número: o servidor já desconectou (ou tentou) e o QR volta ao
        // cartão, com o aviso, pedindo o celular do número salvo (decisão 4).
        if (r.erro === "numero_diferente") {
          const frase = textoNumeroDiferente(r);
          // Reabre pelo resultado, e não só pela conexão da tela (que pode estar velha). Se o
          // celular errado continua na instância (o desconectar falhou), o QR não reabre: a leitura
          // veria a instância conectada e conferiria de novo, sem fim.
          const saiu = r.desconectado !== false;
          if (admin && saiu && qr && reabriuQrW.current < 2) {
            reabriuQrW.current += 1;
            if (caiuQrRef.current) {
              abrirQrComAviso(frase);
              return;
            }
            // a releitura ainda não trouxe o "desconectada": o QR abre quando ela chegar (efeito
            // abaixo); se não chegar logo, a frase vai pelo aviso rápido
            reabrirQrW.current = frase;
            depois(() => {
              if (reabrirQrW.current !== frase) return;
              reabrirQrW.current = null;
              avisar(frase, "info");
              focar("cfg-h-whats");
            }, 8000);
            return;
          }
          // sem como reabrir (o cartão já não é o do número caído, ou o celular não saiu): a frase
          // vai pelo aviso rápido
          avisar(frase, "info");
          focar(caiuQrRef.current ? "cfg-conserto-w" : "cfg-h-whats");
          return;
        }
        avisar(
          r.erro === "sem_acesso"
            ? textoFalhaAcao(r.erro)
            : `Ainda não conectou. ${qr ? `Leia o QR code em "${MOSTRAR_QR}".` : "Cole o token novo."}`,
          "info",
        );
        focar("cfg-conserto-w");
        return;
      }
      reabriuQrW.current = 0;
      setTesteW("ok");
      mostrarHero("check");
      realcar("whats", "flash");
      avisar("WhatsApp conectado. A Janete voltou a atender.");
      focar("cfg-h-whats");
    });
    return true;
  };
  const conferirWhatsRef = useRef(conferirWhats);
  conferirWhatsRef.current = conferirWhats;

  // o QR code no cartão: Z-API ou Evolution com o número fora do celular (desconectada sem ser à
  // mão, ou conectando). Pede a imagem com os dados guardados (pedirQrGuardada, nada é colado nem
  // gravado); conectado, fecha e confere com conferirWhats, que mostra o check.
  const gatewayQr = w.prov && ehGatewayQr(w.prov.id) ? w.prov.id : null;
  const caiuQr = !!gatewayQr && ((w.situacao === "desconectada" && !w.manual) || w.conectando);
  // o que vale agora, para a resposta da conferência (que volta depois de alguns renders)
  const caiuQrRef = useRef(caiuQr);
  caiuQrRef.current = caiuQr;
  // fecha sozinho quando o número conecta (tempo real), quando deixa de ser o caso ou quando a troca abre
  const [qrFechou, setQrFechou] = useState<{ por: "ok" | "erro" } | null>(null);
  if (qrW && (!caiuQr || fluxo)) {
    setQrW(false);
    // a conexão voltou (tempo real ou releitura) ou virou "erro": o retorno vem no efeito abaixo
    if (!fluxo && (w.ok || w.situacao === "erro")) setQrFechou({ por: w.ok ? "ok" : "erro" });
  }
  useEffect(() => {
    if (!qrFechou) return;
    // conectou (o webhook gravou "conectada" antes da próxima consulta do QR): o mesmo caminho do
    // aoConectar, que confere o número (decisão 4) e mostra o check, o aviso e o foco no sucesso;
    // com erro, só o foco
    if (qrFechou.por === "ok" && conferirWhatsRef.current()) return;
    focar("cfg-h-whats");
  }, [qrFechou, focar]);
  // o QR que a conferência pediu de volta abre quando a releitura traz o número caído
  useEffect(() => {
    const frase = reabrirQrW.current;
    if (frase === null) return;
    if (fluxo || !admin) {
      reabrirQrW.current = null;
      return;
    }
    if (!caiuQr) return;
    reabrirQrW.current = null;
    abrirQrComAviso(frase);
    // só a chegada do número caído (ou a troca que abre) decide
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caiuQr, fluxo, admin]);
  const leituraW = useLeituraQr({
    ativo: qrW && admin,
    pedir: async (p) => respostaQr(await acoes.pedirQrGuardada(p)),
    aoConectar: () => {
      setQrW(false);
      conferirWhats();
    },
  });

  const abrirQrW = () => {
    if (!admin || !caiuQr || fluxo || testandoAlgo) return;
    reabriuQrW.current = 0;
    reabrirQrW.current = null;
    setQrW(true);
    zerarTeste();
    // o cartão rola até a vista e o foco vai para o título do QR
    depois(() => rolarAte("whats"), 20);
    focar("cfg-qr-titulo", { atrasoMs: mov ? 360 : 0 });
  };

  const fecharQrW = () => {
    setQrW(false);
    focar("cfg-conserto-w");
  };

  const desconectar = () => {
    setDialogo(null);
    setOcupado("desconectar");
    setWebhookFicou(null);
    // o gateway de antes: depois do Desconectar, a releitura tira a conexão da tela
    const g = w.prov ? (w.prov.id as GatewayCfg) : null;
    void acoes.desconectar().then((r) => {
      if (!vivo.current) return;
      setOcupado(null);
      if (!r.ok) {
        avisar(r.erro === "sem_acesso" ? "Só quem administra a conta desconecta o WhatsApp." : textoFalhaAcao(r.erro, r.mensagem), "info");
        return;
      }
      zerarTeste();
      setTesteW("idle");
      setVerify(null);
      setVerVerify(false);
      if (r.aviso === "webhook_nao_desligado" && g) {
        setWebhookFicou(g);
        avisar(`O WhatsApp foi desconectado, mas não deu para desligar o webhook no provedor. Tire no painel ${PAINEL_WEBHOOK[g]}.`, "info");
      } else if (r.aviso === "webhook_no_painel" && g) {
        avisar(`WhatsApp desconectado. A Janete parou de atender. ${lembreteWebhook(g)}`, "info");
      } else avisar("WhatsApp desconectado. A Janete parou de atender.", "info");
      focar("cfg-h-whats");
    });
  };

  /**
   * Copia e só então diz "Copiado". Chamada dentro do clique, sem await antes: o valor que ainda vem
   * do servidor (o verify token) vai como promessa no ClipboardItem, o único jeito que o Safari
   * aceita. Se o navegador recusar, avisa e deixa o valor à mostra para copiar à mão.
   */
  const copiarTexto = (id: string, valor: Promise<string | null>) => {
    void copiarQuandoChegar(valor).then((c) => {
      if (!vivo.current || !c.texto) return;
      if (c.copiado) {
        setCopiado(id);
        depois(() => setCopiado((atual) => (atual === id ? null : atual)), 1800);
        return;
      }
      setCopiado((atual) => (atual === id ? null : atual));
      // o verify token é o único valor escondido: abre para a pessoa copiar à mão
      if (id === "c-verify") setVerVerify(true);
      avisar("Não deu para copiar; o valor está à mostra.", "info");
    });
  };

  // o verify token da Meta só vem do servidor quando o admin pede (mostrar ou copiar)
  const conexaoId = w.conexao?.id ?? null;
  const verifyAtual = verify && verify.conexaoId === conexaoId ? verify.valor : null;
  const lerVerify = async (): Promise<string | null> => {
    if (demo || !conexaoId) return null;
    if (verifyAtual) return verifyAtual;
    const r = await acoes.verVerifyToken(conexaoId);
    if (!vivo.current) return null;
    if (!r.ok) {
      avisar("Não deu para ler o verify token agora. Tente de novo em instantes.", "info");
      return null;
    }
    setVerify({ conexaoId, valor: r.valor });
    return r.valor;
  };

  const alternarVerify = () => {
    if (verVerify || demo || verifyAtual) {
      setVerVerify((v) => !v);
      return;
    }
    void lerVerify().then((v) => {
      if (v) setVerVerify(true);
    });
  };

  const copiar = (id: string, valor: string) => {
    // o verify token ainda pode vir do servidor: a promessa entra na cópia ainda dentro do clique
    copiarTexto(id, id === "c-verify" && !demo ? lerVerify() : Promise.resolve(valor));
  };

  // o conserto do WhatsApp: com a conexão salva, não obriga a colar de novo o que continua válido
  let consW: ConsertoW | null = null;
  if (!w.prov) consW = { texto: "Conectar um WhatsApp", acao: () => abrirFluxo("whats"), conferir: false };
  else {
    // provDe nunca devolve o "descontinuado": o gateway da tela é um dos 4
    const g = w.prov.id as GatewayCfg;
    const colarDados = () => abrirFluxo("whats", { gateway: g });
    if (w.situacao === "erro")
      consW = { texto: "Colar os dados de novo", acao: colarDados, conferir: false, contorno: { texto: "Conferir de novo", acao: conferirWhats, conferir: true } };
    else if (w.situacao === "desconectada" && w.manual) consW = { texto: "Conectar de novo", acao: colarDados, conferir: false };
    else if (w.situacao === "desconectada" || w.conectando) {
      // Z-API e Evolution: o QR code aparece no próprio cartão, com os dados guardados
      consW = GATEWAY_QR[g]
        ? { texto: MOSTRAR_QR, acao: abrirQrW, conferir: false, contorno: { texto: "Colar os dados de novo", acao: colarDados, conferir: false } }
        : {
            texto: g === "meta" ? "Colar o token novo" : "Colar a chave nova",
            acao: () => abrirFluxo("whats", { gateway: g, soCampo: CAMPO_TOKEN[g] }),
            conferir: false,
            contorno: { texto: "Colar os dados de novo", acao: colarDados, conferir: false },
          };
    }
  }

  /* ---------- cérebro ---------- */

  // chave sem crédito: depois de colocar crédito, o admin testa a mesma chave de novo (conferência grátis)
  const testarChave = () => {
    if (!admin || testeC || cer.situacao !== "sem_credito") return;
    const nome = cer.motor?.nome ?? "provedor";
    setTesteC(true);
    mostrarHero("carregando");
    void comMinimo(acoes.revalidarChave("resposta", { falhar: simCard }), mov ? 2050 : 300).then((r) => {
      if (!vivo.current) return;
      if (!r.ok) {
        setErroTesteC(
          r.erro === "sem_credito"
            ? `Resposta da ${nome}: o saldo ainda não aparece. Depois do pagamento, pode levar alguns minutos.`
            : `Resposta da ${nome}: ${textoFalhaAcao(r.erro, r.mensagem)}`,
        );
        setTesteC(false);
        setHero(null);
        avisar(
          r.erro === "sem_credito" ? "Ainda sem crédito. Teste de novo daqui a pouco ou cole outra chave." : "A chave ainda não respondeu.",
          "info",
        );
        focar("cfg-testar-chave");
        return;
      }
      setErroTesteC(null);
      setTesteC(false);
      zerarTeste();
      mostrarHero("check");
      realcar("cerebro", "flash");
      avisar("Chave aceita. A Janete voltou a responder.");
      focar("cfg-h-cerebro");
    });
  };

  /* ---------- escuta ---------- */

  // sem a chave de áudio, quem passa a transcrever (a ordem do servidor, P14): o cérebro da OpenAI ou
  // da OpenRouter ativo; senão, a chave da voz em uso (nem removida nem inválida); senão, ninguém
  const cerebroTranscreve = cer.ok && (cer.chave?.provedor === "openai" || cer.chave?.provedor === "openrouter");
  const cerebroEmUsoTranscreve =
    !!cer.chave &&
    cer.chave.status !== "invalida" &&
    cer.chave.status !== "removida" &&
    (cer.chave.provedor === "openai" || cer.chave.provedor === "openrouter");
  const vozPassaATranscrever =
    !cerebroEmUsoTranscreve && !!voz.chave && voz.chave.status !== "invalida" && voz.chave.status !== "removida";

  const removerEscuta = () => {
    setDialogo(null);
    setOcupado("remover-escuta");
    const depoisDaEscuta = cerebroTranscreve ? "cerebro" : vozPassaATranscrever ? "voz" : "equipe";
    void acoes.removerChaveAudio().then((r) => {
      if (!vivo.current) return;
      setOcupado(null);
      if (!r.ok) {
        avisar(textoFalhaAcao(r.erro, r.mensagem), "info");
        return;
      }
      zerarTeste();
      avisar(
        depoisDaEscuta === "cerebro"
          ? "Chave de áudio removida. A Janete passa a transcrever com a chave do cérebro."
          : depoisDaEscuta === "voz"
            ? "Chave de áudio removida. A Janete passa a transcrever com a chave da voz."
            : "Chave de áudio removida. Sem escuta, a Janete pede para o lead escrever.",
        "info",
      );
      focar("cfg-h-escuta");
    });
  };

  /* ---------- voz ---------- */

  // a voz está no fio (P13): remover zera a conferência; se era ela quem transcrevia, a Janete passa a
  // pedir texto aos leads que mandam áudio; com a mesma chave na Escuta (E2), ela continua lá
  const removerVoz = () => {
    setDialogo(null);
    setOcupado("remover-voz");
    const transcrevia = esc.viaVoz;
    const mesmaNaEscuta = voz.mesmaChaveDaEscuta;
    void acoes.removerChaveVoz().then((r) => {
      if (!vivo.current) return;
      setOcupado(null);
      if (!r.ok) {
        avisar(textoFalhaAcao(r.erro, r.mensagem), "info");
        return;
      }
      zerarTeste();
      avisar(
        mesmaNaEscuta
          ? "Chave de voz removida. A escuta continua com a mesma chave."
          : transcrevia
            ? "Chave de voz removida. Sem escuta, a Janete pede para o lead escrever."
            : "Chave de voz removida.",
        "info",
      );
      focar("cfg-h-voz");
    });
  };

  // o "Responder em áudio": salva ao escolher (sem rascunho); o foco fica na opção
  const salvarModoVoz = (modo: ModoVoz) => {
    if (!admin || salvandoModo || testandoAlgo || modo === voz.modo) return;
    setSalvandoModo(modo);
    void comMinimo(acoes.salvarModoVoz(modo), mov ? 450 : 0).then((r) => {
      if (!vivo.current) return;
      setSalvandoModo(null);
      if (!r.ok) {
        avisar(r.erro === "sem_acesso" ? "Só quem administra a conta muda a voz." : textoFalhaAcao(r.erro, r.mensagem), "info");
        return;
      }
      setModoGravado(r.modo);
      // o nó da voz muda com o modo (no "Nunca" ele fica neutro): a conferência anterior deixa de valer
      zerarTeste();
      avisar("Modo salvo.");
    });
  };

  /* ---------- ritmo ---------- */

  const salvarRitmo = () => {
    if (!admin || salvando) return;
    const r = rasc;
    setSalvando(true);
    void comMinimo(acoes.salvarRitmo(r.espera, r.teto), mov ? 650 : 120).then((res) => {
      if (!vivo.current) return;
      setSalvando(false);
      if (!res.ok) {
        avisar(res.erro === "sem_acesso" ? "Só quem administra a conta muda o ritmo." : textoFalhaAcao(res.erro, res.mensagem), "info");
        return;
      }
      avisar(`Ritmo salvo. A Janete espera ${res.espera} s depois da última mensagem, até ${res.teto} s.`);
      focar("cfg-h-ritmo");
    });
  };

  /* ---------- a saúde ---------- */

  const parado = !w.ok || (cer.conhecida && !cer.ok) || parouMotor;
  // só o atraso: o cartão Ritmo diz "Atrasada agora", e não "Parada agora"
  const atrasada = soAtrasada(w, cer, andamento);
  const consC = cer.conhecida && !cer.ok ? { texto: cer.situacao === "removida" ? "Conectar uma chave" : "Colar outra chave", acao: () => abrirFluxo(cer.motor ? "chave" : "motor") } : null;
  // o onboarding aberto vem antes do cérebro na Saúde (textosSaude): o conserto leva até ele
  const consO =
    andamento.estado === "onboarding" && router ? { texto: "Concluir o onboarding", acao: () => void router.navigate({ to: "/onboarding" }) } : null;
  const consSaude = !w.ok ? (consW ? { texto: consW.texto, acao: consW.acao } : null) : (consO ?? consC);
  // com o QR já aberto no cartão, a Saúde não repete o "Mostrar o QR code"
  const conserto = admin && parado && consSaude && !testandoAlgo && !fluxo && !qrW ? consSaude : null;

  const cheia = !!fluxo && fluxo.telaCheia;
  const alvoIdx = fluxo ? (cheia ? 0 : ORDEM_CARTOES[CARTAO_DO_FLUXO[fluxo.tipo]]) : 99;
  const oculto = (cartao: Cartao) => ORDEM_CARTOES[cartao] >= alvoIdx;
  const realceDe = (cartao: Cartao) => (realce && realce.cartao === cartao ? realce.tipo : null);

  // o leitor de tela ouve o aviso rápido e a conferência
  const saude = textosSaude({ w, cer, esc, voz, teste, andamento, admin, qrAberto: qrW });
  const anuncio = toast ? toast.texto : teste.rodando ? saude.sub : teste.fim ? `${saude.titulo}. ${saude.sub}` : "";

  return (
    <VistaArea area="configuracao">
      <div className={c.cfRaiz} data-papel={admin ? "admin" : "atendente"}>
        <div className={c.cfGrade}>
          <Saude
            oculto={cheia}
            admin={admin}
            w={w}
            cer={cer}
            esc={esc}
            voz={voz}
            espera={salvo.espera}
            teto={salvo.teto}
            andamento={andamento}
            teste={teste}
            hero={hero}
            conserto={conserto}
            qrAberto={qrW}
            testeBloqueado={testandoAlgo || !!fluxo || qrW || !!salvandoModo}
            aoTestarTudo={testarTudo}
            aoIr={irPeca}
          />
          <div className={c.cfBlocos}>
            <CartaoWhats
              admin={admin}
              w={w}
              teste={testeW}
              bloqueado={testandoAlgo}
              realce={realceDe("whats")}
              oculto={oculto("whats")}
              conserto={consW}
              verWebhook={verWebhook}
              aoAlternarWebhook={() => setVerWebhook((v) => !v)}
              verVerify={verVerify}
              aoAlternarVerify={alternarVerify}
              verifyToken={verifyAtual}
              copiado={copiado}
              aoCopiar={copiar}
              demo={demo}
              simular={simCard}
              aoSimular={setSimCard}
              aoTestar={testarWhats}
              aoTrocar={() => abrirFluxo("whats")}
              aoDesconectar={() => setDialogo("desconectar")}
              desconectando={ocupado === "desconectar"}
              lembreteWebhook={
                webhookFicou ? `Não deu para desligar o webhook no provedor. Tire no painel ${PAINEL_WEBHOOK[webhookFicou]}.` : undefined
              }
              qr={
                qrW && gatewayQr ? (
                  <PassoQr
                    estado={leituraW.estado}
                    gateway={gatewayQr}
                    variante="cartao"
                    idTitulo="cfg-qr-titulo"
                    numero={w.numero.startsWith("+") ? w.numero : undefined}
                    // o motivo num lugar só: quando o alerta do cartão já diz o mesmo, o QR não repete
                    aviso={
                      avisoQrW && w.erro !== textoFalhaAcao("numero_diferente")
                        ? avisoQrW
                        : undefined
                    }
                    aoGerarOutro={leituraW.gerarOutro}
                    acoes={
                      <Botao variante="contorno" onClick={fecharQrW}>
                        Cancelar
                      </Botao>
                    }
                  />
                ) : undefined
              }
            />
            <CartaoCerebro
              admin={admin}
              cer={cer}
              esc={esc}
              agora={agora}
              testando={testeC}
              bloqueado={testandoAlgo}
              erroTeste={erroTesteC}
              realce={realceDe("cerebro")}
              oculto={oculto("cerebro")}
              demo={demo}
              simular={simCard}
              aoSimular={setSimCard}
              aoTestarChave={testarChave}
              aoTrocarChave={() => abrirFluxo(cer.motor ? "chave" : "motor")}
              aoTrocarModelo={() => abrirFluxo("modelo")}
              aoTrocarMotor={() => abrirFluxo("motor")}
            />
            <CartaoEscuta
              admin={admin}
              esc={esc}
              agora={agora}
              bloqueado={testandoAlgo}
              realce={realceDe("escuta")}
              oculto={oculto("escuta")}
              aoConectar={() => abrirFluxo("escuta")}
              aoRemover={() => setDialogo("remover-escuta")}
              removendo={ocupado === "remover-escuta"}
            />
            <CartaoVoz
              admin={admin}
              voz={voz}
              agora={agora}
              bloqueado={testandoAlgo}
              realce={realceDe("voz")}
              oculto={oculto("voz")}
              aoConectar={() => abrirFluxo("voz")}
              aoEscolherVoz={() => abrirFluxo("vozes")}
              aoMudarModo={salvarModoVoz}
              salvandoModo={salvandoModo}
              aoRemover={() => setDialogo("remover-voz")}
              removendo={ocupado === "remover-voz"}
            />
            <CartaoRitmo
              admin={admin}
              salvo={salvo}
              rascunho={rasc}
              salvando={salvando}
              aoMudar={(campo, delta) => setRasc((r) => mudarRitmo(r, campo, delta))}
              aoDesfazer={() => {
                setRasc(salvo);
                focar("cfg-h-ritmo");
              }}
              aoSalvar={salvarRitmo}
              verTempo={verTempo}
              aoAlternarTempo={() => setVerTempo((v) => !v)}
              realce={realceDe("ritmo")}
              oculto={oculto("ritmo")}
              saudavel={!parado}
              atrasada={atrasada}
            />
            {fluxo && admin && (
              <Fluxo
                key={fluxo.id}
                abertura={fluxo}
                w={w}
                cer={cer}
                esc={esc}
                voz={voz}
                acoes={acoes}
                modo={modo}
                aoFechar={fecharFluxo}
                aoAplicado={trocaAplicada}
                aoAvisar={avisar}
                aoHero={mostrarHero}
                aoTravar={(t) => {
                  travadoRef.current = t;
                }}
              />
            )}
          </div>
        </div>
        <p className={c.cfSr} role="status" aria-live="polite">
          {anuncio}
        </p>
      </div>
      {dialogo === "desconectar" && admin && (
        <DialogoConfirmar
          titulo="Desconectar o WhatsApp?"
          texto={`A Janete para de receber e de responder mensagens no ${w.numero} até você conectar um WhatsApp de novo.${
            w.prov && (w.prov.id === "meta" || w.prov.id === "zapi") ? ` ${lembreteWebhook(w.prov.id)}` : ""
          }`}
          acao="Desconectar"
          aoCancelar={() => {
            setDialogo(null);
            focar("cfg-desconectar");
          }}
          aoConfirmar={desconectar}
        />
      )}
      {dialogo === "remover-escuta" && admin && (
        <DialogoConfirmar
          titulo="Remover a chave de áudio?"
          texto={
            cerebroTranscreve
              ? "A Janete passa a transcrever os áudios com a chave do cérebro."
              : vozPassaATranscrever
                ? "A Janete passa a transcrever os áudios com a chave da voz (ElevenLabs)."
                : "Sem ela, a Janete não entende os áudios dos leads: pede para o lead escrever e, se ele mandar áudio de novo, passa a conversa para a equipe."
          }
          acao="Remover"
          aoCancelar={() => {
            setDialogo(null);
            focar("cfg-remover-escuta");
          }}
          aoConfirmar={removerEscuta}
        />
      )}
      {dialogo === "remover-voz" && admin && (
        <DialogoConfirmar
          titulo="Remover a chave de voz?"
          texto={
            // a mesma chave na Escuta (E2): remover tira só da voz, a escuta continua com ela
            voz.mesmaChaveDaEscuta
              ? "A chave sai da voz: a Janete passa a responder só em texto. A Escuta de áudio continua com a mesma chave. Dá para conectar de novo quando quiser."
              : esc.viaVoz
                ? "A chave da ElevenLabs sai da Janete: ela passa a responder só em texto, e os áudios dos leads deixam de virar texto: a Janete pede para o lead escrever. Dá para conectar de novo quando quiser."
                : "A chave da ElevenLabs sai da Janete: ela passa a responder só em texto. Dá para conectar de novo quando quiser."
          }
          acao="Remover"
          aoCancelar={() => {
            setDialogo(null);
            focar("cfg-remover-voz");
          }}
          aoConfirmar={removerVoz}
        />
      )}
      {toast &&
        typeof document !== "undefined" &&
        createPortal(
          // fora do [data-identidade] da página: o contêiner leva a identidade para herdar a fonte
          <div data-identidade="aipro" key={toast.id}>
            <div className={c.cfToast} data-tom={toast.tom} aria-hidden="true">
              <Ic d={toast.tom === "info" ? ICX.info : IC.ok} />
              <span>{toast.texto}</span>
            </div>
          </div>,
          document.body,
        )}
    </VistaArea>
  );
}

interface PropsDialogo {
  titulo: string;
  texto: string;
  /** O botão de perigo ("Desconectar", "Remover"). */
  acao: string;
  aoCancelar: () => void;
  aoConfirmar: () => void;
}

/** A confirmação de uma ação que para alguma peça: o foco preso, Esc e o véu cancelam. */
function DialogoConfirmar({ titulo, texto, acao, aoCancelar, aoConfirmar }: PropsDialogo) {
  const caixa = useRef<HTMLElement>(null);
  useEffect(() => {
    const t = setTimeout(() => document.getElementById("cfg-dlg-cancelar")?.focus({ preventScroll: true }), 30);
    return () => clearTimeout(t);
  }, []);

  const tecla = (ev: KeyboardEvent<HTMLElement>) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      aoCancelar();
      return;
    }
    if (ev.key !== "Tab" || !caixa.current) return;
    const bts = caixa.current.querySelectorAll<HTMLButtonElement>("button");
    if (!bts.length) return;
    const primeiro = bts[0]!;
    const ultimo = bts[bts.length - 1]!;
    if (ev.shiftKey && document.activeElement === primeiro) {
      ev.preventDefault();
      ultimo.focus();
    } else if (!ev.shiftKey && document.activeElement === ultimo) {
      ev.preventDefault();
      primeiro.focus();
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    // o véu vai para o <body>, fora do [data-identidade] da página: leva a identidade para herdar a fonte
    <div className={c.cfVeu} data-identidade="aipro" onClick={aoCancelar}>
      <section
        ref={caixa}
        className={c.cfDialogo}
        role="alertdialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby="cfg-dlg-titulo"
        aria-describedby="cfg-dlg-texto"
        onKeyDown={tecla}
        onClick={(ev) => ev.stopPropagation()}
      >
        <h2 id="cfg-dlg-titulo" className={c.cfHCartao}>
          {titulo}
        </h2>
        <p id="cfg-dlg-texto" className={c.cfDialogoTexto}>
          {texto}
        </p>
        <div className={c.cfDialogoAcoes}>
          <Botao id="cfg-dlg-cancelar" variante="contorno" onClick={aoCancelar}>
            Cancelar
          </Botao>
          <Botao variante="perigo" onClick={aoConfirmar}>
            {acao}
          </Botao>
        </div>
      </section>
    </div>,
    document.body,
  );
}
