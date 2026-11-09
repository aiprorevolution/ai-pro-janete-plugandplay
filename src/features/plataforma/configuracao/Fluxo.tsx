import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { JaneteSimbolo } from "@/components/janete/JaneteSimbolo";
import { movimentoReduzido } from "@/components/janete/VooJanete";
import { Botao, Campo, Selo, cx } from "@/components/aipro";
import { modelosDo, precoTexto } from "@/features/ia/modelos";
import {
  AvisoErro,
  Dobra,
  Icone,
  Linha,
  ListaDeVozes,
  LogoTile,
  focarAgora,
  lerCampo,
  limparCampo,
  s as lista,
  useDepois,
  useListaVozes,
  useValidacao,
} from "@/features/onboarding/lista";
import {
  DIFICULDADE,
  FASES_FECHADAS,
  FASES_SOB,
  GIRO_IA_MS,
  GIRO_WHATSAPP_MS,
  IC,
  MODOS,
  MOTORES,
  PROVS,
  camposLargos,
  separarMensagem,
  type CampoGateway,
  type Fase,
  type Motor,
} from "@/features/onboarding/lista/dados";
import type { ModoConexao } from "@/features/onboarding/estado";
import { precoDe } from "@/features/onboarding/cerebro/modelosTela";
import { PassoQr, tempoVoltaDisco } from "@/features/onboarding/conexao/qr/PassoQr";
import { useLeituraQr } from "@/features/onboarding/conexao/qr/useLeituraQr";
import type { ModeloListado } from "@/features/servidor/listar-modelos";
import { formatarNumero, normalizarNumero } from "@/features/servidor/numero-whatsapp";
import { ehGatewayQr, type GatewayQr } from "@/features/servidor/qr-conexao";

import {
  modelosCurados,
  type AcoesConfiguracao,
  type ConexaoSalva,
  type FalhaConfiguracao,
  type ModelosDaChave,
  type ResultadoConfiguracao,
} from "../dados/configuracao";
import type { ModoDados } from "../dados/tipos";
import {
  AJUDA_CHAVE_ESCUTA_ELEVENLABS,
  AJUDA_CHAVE_VOZ,
  ERRO_GATEWAY,
  NUMERO_EXEMPLO,
  ORDEM_GATEWAYS,
  PASSOS_VOZ,
  PROVEDOR_VOZ,
  TRANSCRITORES,
  acharTranscritor,
  artigoNome,
  chaveTemFinal,
  comMinimo,
  deNome,
  maiuscula,
  respostaQr,
  ultimos4De,
  urlWebhook,
  vaiDarErro,
  type GatewayCfg,
  type ProvedorVoz,
  type Transcritor,
} from "./dados";
import { c } from "./estilos";
import { motorDe, type LeituraC, type LeituraE, type LeituraV, type LeituraW } from "./leitura";
import { ICX, LinhaFluxo } from "./pecas";
import type { HeroJanete } from "./Saude";
import { perguntaUsarNaEscuta, perguntaUsarNaVoz, type PerguntaTambem } from "./tambem";
import { textoAvisoConexao, textoFalhaAcao, textoWebhookAnterior } from "./textos";

/** Quantos modelos a lista mostra de uma vez (a OpenRouter devolve centenas: a busca afina). */
const MAX_MODELOS_NA_LISTA = 60;

/** O 3º passo da troca da escuta: o servidor confere a chave, não transcreve um áudio de verdade. */
export const PASSO_ESCUTA_TRANSCREVE = "Conferindo se a chave transcreve áudio";

/** A lista de vozes (spec-voz-uso, C3): o título e a frase do fluxo. */
const TITULO_VOZES = "Escolher a voz da Janete";
const SUB_VOZES = "Ouça e escolha a voz que a Janete usa nos áudios.";


/**
 * O que se troca: o WhatsApp, a chave, o modelo, o provedor do cérebro, a escuta de áudio, a chave
 * da voz ou a voz escolhida (`vozes`: a lista das vozes da conta, com a chave guardada).
 */
export type TipoFluxo = "whats" | "chave" | "modelo" | "motor" | "escuta" | "voz" | "vozes";

export interface AberturaFluxo {
  tipo: TipoFluxo;
  /** Abre direto no gateway (o conserto da conexão salva). */
  gateway?: GatewayCfg | undefined;
  /** Só um campo (o token que venceu na Meta ou na Zernio). */
  soCampo?: string | undefined;
  /** Abaixo de 900 px: tela cheia modal. */
  telaCheia: boolean;
  /** Para a remontagem a cada abertura. */
  id: number;
}

interface Props {
  abertura: AberturaFluxo;
  w: LeituraW;
  cer: LeituraC;
  esc: LeituraE;
  voz: LeituraV;
  /** As ações da Configuração (dados/configuracao.ts): o servidor no banco, a memória no exemplo. */
  acoes: AcoesConfiguracao;
  /** No exemplo, a validação é simulada ("invalid" ou a caixa "Simular" caem no erro). */
  modo: ModoDados;
  /** Fecha o fluxo; `nasce` quando a troca valeu (o cartão volta desdobrando). */
  aoFechar: (efeito?: "nasce") => void;
  /** A troca foi gravada: a conferência anterior deixa de valer, feche o fluxo como fechar. */
  aoAplicado: () => void;
  aoAvisar: (texto: string, tom?: "ok" | "info") => void;
  aoHero: (h: HeroJanete) => void;
  aoTravar: (travado: boolean) => void;
}

/**
 * `vozes`: a lista de vozes, aberta direto (tipo "vozes"), depois da chave aceita (tipo "voz") ou
 * depois do "Sim" da escuta com a ElevenLabs (tipo "escuta", E3 da spec da escuta com a ElevenLabs).
 */
type Etapa = "chave" | "modelos" | "tudo" | "vozes";

/**
 * O "Chave aceita" de uma chave da ElevenLabs (escuta ou voz): a pergunta "usar também no outro
 * cartão?" (tambem.ts), calculada com a leitura do outro cartão no momento do aceite, para não mudar
 * na tela quando os dados forem relidos. Sem pergunta (o outro cartão já usa a chave, P6), a linha
 * que diz isso.
 */
interface Tambem {
  pergunta: PerguntaTambem | null;
  linha: string;
}

interface CampoTela {
  id: string;
  label: string;
  ph: string;
  segredo: boolean;
  opcional: boolean;
  ajuda?: string | undefined;
  largo: boolean;
  /** O número do WhatsApp: type, inputMode e autocomplete "tel". */
  tel?: boolean | undefined;
}

const FOCAVEIS = "button, input, [href], [tabindex]:not([tabindex='-1'])";

/**
 * Trocar: a mesma lista em acordeão e a mesma validação do onboarding (o cartão dobra no disco, o
 * logo gira e pousa no check ou no alerta), dentro da Configuração. No banco, a validação é a das
 * funções de servidor (salvarConexao, salvarChaveIA, listarModelos, trocarModeloIA); no exemplo,
 * é simulada, e a chave com "invalid"/"erro" (ou a caixa "Simular") cai no erro.
 * O cartão de baixo some enquanto o fluxo está aberto; no celular, ele ocupa a tela inteira.
 */
export function Fluxo({ abertura, w, cer, esc, voz, acoes, modo: modoDados, aoFechar, aoAplicado, aoAvisar, aoHero, aoTravar }: Props) {
  const demo = modoDados === "exemplo";
  const { tipo, telaCheia } = abertura;
  const { depois, focar } = useDepois();
  const mov = !movimentoReduzido();

  // o que valia quando o fluxo abriu: depois do sucesso o título e os avisos não mudam
  const [antes] = useState(() => ({
    reconectar: !w.ok,
    wOk: w.ok,
    numero: w.numero,
    curto: w.prov?.curto ?? "",
    cerOk: cer.ok,
    cerRemovida: cer.situacao === "removida",
    ultimos4: cer.chave?.ultimos4 ?? "",
    motor: cer.motor,
    nomeModelo: cer.nomeModelo,
    modeloAtual: cer.chave?.modelo ?? null,
    provedorAtual: cer.chave?.provedor ?? null,
    escOk: esc.ok,
    escProv: esc.chave?.provedor ?? null,
    vozOk: voz.chave?.status === "ativa",
    // com uma chave guardada que não está ativa (sem crédito, inválida), o fluxo também é de troca
    vozTem: !!voz.chave,
    // a voz escolhida: salvar a mesma de novo só vale quando ela tinha sumido da conta (limpa o erro)
    vozAtual: voz.voz,
    vozSumiu: voz.aviso === "voz_nao_encontrada",
  }));

  const [modo, setModo] = useState<ModoConexao | null>(() =>
    tipo === "whats" && abertura.gateway ? PROVS[abertura.gateway].modo : null,
  );
  const [item, setItem] = useState<string | null>(() => {
    if (tipo === "whats") return abertura.gateway ?? null;
    if (tipo === "chave" || tipo === "modelo") return antes.motor?.id ?? "anthropic";
    // a voz tem um provedor só: abre direto no painel, como a chave do cérebro (e a lista de vozes)
    if (tipo === "voz" || tipo === "vozes") return PROVEDOR_VOZ.id;
    return null;
  });
  const [soCampo, setSoCampo] = useState<string | null>(abertura.soCampo ?? null);
  // "Colar os dados de novo" na Evolution: o nome da instância atual já vem preenchido, para o nome
  // vazio não criar uma "janete" a mais no servidor da pessoa (spec-qr-whatsapp, seção 7). Na Z-API e
  // na Evolution, o número salvo também (o nome da conexão nova é o número formatado; seção 8). A
  // troca para outra conexão não preenche nada (escolherItem zera os campos).
  const [campos, setCampos] = useState<Record<string, string>>(() => {
    const inicio: Record<string, string> = {};
    if (tipo !== "whats" || !abertura.gateway || w.conexao?.gateway !== abertura.gateway) return inicio;
    if (abertura.gateway === "evolution" && w.conexao.id_externo) inicio["instanceName"] = w.conexao.id_externo;
    if (ehGatewayQr(abertura.gateway) && w.numero.startsWith("+")) inicio["numero"] = w.numero;
    return inicio;
  });
  const [revelar, setRevelar] = useState<Record<string, boolean>>({});
  const [campoErro, setCampoErro] = useState<string | null>(null);
  const [avisoErro, setAvisoErro] = useState(false);
  const [simular, setSimular] = useState(false);
  const [modelo, setModelo] = useState<string | null>(tipo === "modelo" ? antes.modeloAtual : null);
  const [busca, setBusca] = useState("");
  const [etapa, setEtapa] = useState<Etapa>(tipo === "modelo" ? "modelos" : tipo === "vozes" ? "vozes" : "chave");
  // a lista de vozes (contrato F4): busca com a chave guardada só quando aparece; escolher só marca
  // a voz, e "Salvar a voz" grava (escolherVoz). Na escuta, ela vem depois do "Sim" (E3).
  const naLista = tipo === "vozes" || ((tipo === "voz" || tipo === "escuta") && etapa === "vozes");
  /** A lista que vem logo depois de uma chave (fluxos "escuta" e "voz"): ganha o "Escolher depois" (P10). */
  const listaAposChave = naLista && tipo !== "vozes";
  const listaVozes = useListaVozes(naLista ? acoes.listarVozes : null);
  const [vozMarcada, setVozMarcada] = useState<string | null>(null);
  const [vozSalvando, setVozSalvando] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(tipo === "modelo");
  const [desdobra, setDesdobra] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [desativou, setDesativou] = useState(false);
  const [ultimos4, setUltimos4] = useState("");
  /** A pergunta do "Chave aceita" da ElevenLabs (null fora dela). */
  const [tambem, setTambem] = useState<Tambem | null>(null);
  /** O "Sim" em curso (os dois botões desligados) e a falha dele, na própria pergunta (P9). */
  const [copiando, setCopiando] = useState(false);
  const [erroCopia, setErroCopia] = useState<string | null>(null);
  /** O "Sim" copiou a chave para o outro cartão: escolhe a mensagem de fim. */
  const [copiou, setCopiou] = useState(false);
  /** A lista de modelos: a do provedor (banco) ou a curada (exemplo, ou a reserva quando o provedor falha). */
  const [listaModelos, setListaModelos] = useState<ModeloListado[] | null>(null);
  const [avisoLista, setAvisoLista] = useState<string | null>(null);
  /** A recusa da última validação (o palco do erro e o campo marcado). */
  const [falhou, setFalhou] = useState<FalhaConfiguracao | null>(null);
  /** O que a conexão salva devolveu (o número, o webhook e o token da Meta, os avisos). */
  const [salva, setSalva] = useState<ConexaoSalva | null>(null);
  const [copiadoF, setCopiadoF] = useState<string | null>(null);
  /** O que o "Conectar" leu, para o passo do QR pedir a imagem (apagado no sucesso e no "Corrigir os dados"). */
  const qrDados = useRef<{ gateway: GatewayQr; campos: Record<string, string> } | null>(null);
  /**
   * O celular de outro número leu o QR (numero_diferente no salvar; spec-qr-whatsapp, seção 8): o
   * passo mostra os 2 números (formatados pelo servidor), com "Usar o …" e "Desconectar e ler de
   * novo". Enquanto vale, a leitura do QR fica parada.
   */
  const [diferente, setDiferente] = useState<{ conectado: string; informado: string } | null>(null);
  const [desconectando, setDesconectando] = useState(false);
  const [erroDiferente, setErroDiferente] = useState<string | null>(null);
  /**
   * Cada "Desconectar e ler de novo" tem a sua rodada: validar de novo ou voltar aos dados invalida a
   * resposta que chegar depois (como na EtapaConexao). Fechar desmonta o fluxo (o `vivo` cobre).
   */
  const rodadaDesconectar = useRef(0);
  /**
   * O celular na instância leu o QR desta troca (o "Conectar" achou a instância desconectada, ou o
   * "Desconectar" tirou o anterior): só ele sai sozinho quando a pessoa deixa o aviso do outro número
   * sem escolher. Uma instância que já estava conectada antes (a conexão no ar, por exemplo) não cai.
   */
  const lidoAqui = useRef(false);
  /**
   * O desconectar em curso (o do botão ou o da saída): o próximo "Conectar" espera ele terminar, para
   * não achar a instância ainda com o celular errado. Sem nenhum em curso, o "Conectar" chama na hora.
   */
  const soltando = useRef<Promise<void> | null>(null);
  const guardarSoltando = (pedido: Promise<unknown>) => {
    const fim: Promise<void> = pedido.then(
      () => {
        if (soltando.current === fim) soltando.current = null;
      },
      () => {
        if (soltando.current === fim) soltando.current = null;
      },
    );
    soltando.current = fim;
  };
  /** O salvar depois do QR lido espera o disco voltar a ser círculo (tempoVoltaDisco). */
  const voltaDisco = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * A chave de IA (cérebro, escuta e voz) fica só no `<input>`, não controlado (ver
   * onboarding/lista/campos.ts): o estado guarda só o tamanho e se ela tem final, e a chave é lida
   * na hora de validar. Os campos do WhatsApp continuam controlados.
   */
  const chaveSoNoCampo = tipo !== "whats";
  const [medidaChave, setMedidaChave] = useState({ tamanho: 0, final: false });
  /** Provedor com a chave antes: a chave aceita espera aqui (fora do estado e do DOM) até gravar com o modelo. */
  const chaveConferida = useRef("");
  const vivo = useRef(true);
  useEffect(() => {
    // religa na (re)montagem: no StrictMode o React monta, desmonta e monta de novo
    vivo.current = true;
    return () => {
      vivo.current = false;
      chaveConferida.current = "";
    };
  }, []);

  const val = useValidacao(tipo === "whats" ? GIRO_WHATSAPP_MS : GIRO_IA_MS);
  const { fase } = val;
  const travado = fase === "fechando" || fase === "verificando" || fase === "reabrindo" || salvando || copiando || val.preparando;
  const fechada = FASES_FECHADAS.includes(fase);
  const sob = FASES_SOB.includes(fase);

  const aoTravarRef = useRef(aoTravar);
  aoTravarRef.current = aoTravar;
  useEffect(() => {
    aoTravarRef.current(travado);
  }, [travado]);
  useEffect(() => () => aoTravarRef.current(false), []);

  // a lista de modelos vem do provedor, com a chave guardada (listarModelosDaChave); no exemplo, a
  // curada depois de um instante. Se o provedor falhar, a curada entra como reserva, com aviso.
  useEffect(() => {
    if (tipo !== "modelo") return;
    void comMinimo(acoes.listarModelosDaChave("resposta"), mov ? 1100 : 200).then((r) => {
      if (!vivo.current) return;
      aplicarLista(r, antes.provedorAtual);
      setCarregando(false);
    });
    // só na abertura
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function aplicarLista(r: ResultadoConfiguracao<ModelosDaChave>, provedor: string | null) {
    if (r.ok) {
      setListaModelos(r.modelos.length ? r.modelos : modelosCurados(provedor as Motor["id"] | null));
      setAvisoLista(
        r.origem === "lista_curada" && !demo ? "O provedor não respondeu agora: a lista é a nossa, com os modelos mais usados." : null,
      );
    } else {
      setListaModelos(modelosCurados(provedor as Motor["id"] | null));
      setAvisoLista(`Não deu para buscar a lista no provedor agora. ${textoFalhaAcao(r.erro, r.mensagem)} Mostramos a nossa lista.`);
    }
  }

  // o foco vai para o título (ou para o único campo, no conserto do token)
  useEffect(() => {
    if (abertura.soCampo && abertura.gateway) focar(idCampo(abertura.soCampo), { atrasoMs: mov ? 260 : 30 });
    else focar("cfg-fluxo-titulo", { atrasoMs: 30 });
    if (!telaCheia && typeof document !== "undefined") {
      depois(() => {
        const el = document.getElementById("cfg-fluxo");
        if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest", behavior: mov ? "smooth" : "auto" });
      }, 30);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- quem é quem ---------- */

  const motorEscolhido: Motor | null =
    tipo === "whats" || tipo === "escuta" || tipo === "voz" || tipo === "vozes" ? null : motorDe(item as Motor["id"] | null);
  const transcritor: Transcritor | null = tipo === "escuta" ? acharTranscritor(item as Transcritor["id"] | null) : null;
  const provVoz: ProvedorVoz | null = tipo === "voz" || tipo === "vozes" ? PROVEDOR_VOZ : null;
  // a chave da ElevenLabs (a voz, ou a escuta com ela): a mesma ajuda, os mesmos passos, a mesma
  // recusa por falta de acesso ou crédito e a pergunta "usar também no outro cartão?"
  const chaveEleven = tipo === "voz" || (tipo === "escuta" && transcritor?.id === "elevenlabs");
  const ajudaEleven = tipo === "voz" ? AJUDA_CHAVE_VOZ : AJUDA_CHAVE_ESCUTA_ELEVENLABS;
  // a voz marcada: a que a pessoa escolheu agora, ou a atual quando ela está na lista
  const prontaVozes = listaVozes.estado.k === "pronta" ? listaVozes.estado : null;
  const atualNaLista =
    prontaVozes?.atual && prontaVozes.vozes.some((v) => v.id === prontaVozes.atual!.id) ? prontaVozes.atual.id : null;
  const valorVoz = vozMarcada ?? atualNaLista;
  const mesmaVoz = !!valorVoz && valorVoz === antes.vozAtual?.id && !antes.vozSumiu;
  const gateway = tipo === "whats" && item ? (item as GatewayCfg) : null;
  const prov = gateway ? PROVS[gateway] : null;
  const dono = provVoz ?? transcritor ?? motorEscolhido;

  function idCampo(campo: string): string {
    return tipo === "whats" ? `cfg-f-${item ?? abertura.gateway}-${campo}` : `cfg-f-${campo}`;
  }

  /** A chave colada: do `<input>` (cérebro, escuta e voz) ou do estado (WhatsApp, que não tem campo "chave"). */
  function lerChave(): string {
    return chaveSoNoCampo ? lerCampo(idCampo("chave")) : (campos["chave"] ?? "");
  }

  /** Apaga a chave do campo e a medida dela (sucesso e fechar). */
  function apagarChave() {
    if (!chaveSoNoCampo) return;
    limparCampo(idCampo("chave"));
    setMedidaChave({ tamanho: 0, final: false });
  }

  function camposDef(): CampoTela[] {
    if (!item) return [];
    if (tipo === "whats" && prov) {
      const lista0: readonly CampoGateway[] = soCampo ? prov.campos.filter((x) => x.id === soCampo) : prov.campos;
      const largos = camposLargos(lista0);
      return lista0.map((x) => ({
        id: x.id,
        label: x.label,
        ph: x.ph,
        segredo: !!x.segredo,
        opcional: !!x.opcional,
        ajuda: x.ajuda,
        largo: !!soCampo || largos.has(x.id),
        tel: !!x.tel,
      }));
    }
    if (tipo === "modelo") return [];
    if (tipo === "motor" && etapa === "modelos") return [];
    if (naLista) return [];
    return [
      {
        id: "chave",
        label: `Chave ${deNome(dono)}`,
        ph: "Cole a chave aqui",
        segredo: true,
        opcional: false,
        ajuda: chaveEleven ? ajudaEleven : "Depois de validada, a chave fica guardada com segurança e nunca é mostrada de novo.",
        largo: true,
      },
    ];
  }

  const defs = camposDef();
  const podeValidar =
    defs.length > 0 &&
    defs.every((d) => {
      if (d.opcional) return true;
      if (d.id === "chave" && chaveSoNoCampo) return medidaChave.tamanho >= 8 && medidaChave.final;
      const v = (campos[d.id] ?? "").trim();
      // a chave precisa de 8 caracteres e de um final de verdade (letras ou números) para mostrar
      return d.id === "chave" ? v.length >= 8 && chaveTemFinal(v) : v.length >= 1;
    });

  /* ---------- escolhas ---------- */

  const escolherModo = (m: ModoConexao) => {
    if (travado) return;
    setModo(m);
    setItem(null);
    setCampos({});
    setCampoErro(null);
    setAvisoErro(false);
    focar("cfg-olho-itens", { atrasoMs: mov ? 260 : 0 });
  };

  const trocarModo = () => {
    if (travado) return;
    const de = modo ?? "oficial";
    setModo(null);
    setItem(null);
    setCampos({});
    setCampoErro(null);
    setAvisoErro(false);
    setSoCampo(null);
    focar(`cfg-modo-${de}`, { atrasoMs: mov ? 260 : 0 });
  };

  const escolherItem = (id: string) => {
    if (travado) return;
    setItem(id);
    setCampos({});
    setMedidaChave({ tamanho: 0, final: false });
    setRevelar({});
    setCampoErro(null);
    setAvisoErro(false);
    setBusca("");
    setSoCampo(null);
    let alvo = "cfg-f-chave";
    if (tipo === "motor") {
      const m = motorDe(id as Motor["id"]);
      setEtapa(m?.busca ? "tudo" : "chave");
      const recomendado = modelosDo(id as Motor["id"]).find((x) => x.recomendado) ?? modelosDo(id as Motor["id"])[0];
      setModelo(id === antes.provedorAtual ? antes.modeloAtual : (recomendado?.id ?? null));
      if (m?.busca) alvo = "cfg-busca-modelo";
    }
    if (tipo === "whats") alvo = `cfg-f-${id}-${PROVS[id as GatewayCfg].campos[0]?.id ?? ""}`;
    focar(alvo, { atrasoMs: mov ? 380 : 0 });
  };

  const voltarItem = () => {
    if (travado) return;
    const id = item;
    setItem(null);
    setCampoErro(null);
    setAvisoErro(false);
    setSoCampo(null);
    focar(`cfg-it-${id}`, { atrasoMs: mov ? 260 : 0 });
  };

  /* ---------- validar e aplicar ---------- */

  const passos: readonly string[] =
    tipo === "whats" && prov
      ? prov.passos
      : chaveEleven
        ? PASSOS_VOZ
        : tipo === "escuta"
          ? // o salvarChaveIA só confere a chave (nenhum áudio é transcrito): o texto diz o que o servidor faz
            [`Falando com ${artigoNome(transcritor)}`, "Conferindo a chave", PASSO_ESCUTA_TRANSCREVE]
          : [`Falando com ${artigoNome(motorEscolhido)}`, "Conferindo a chave", "Buscando os modelos liberados"];

  /**
   * A ação de cada troca (no banco, a função de servidor; no exemplo, a memória). `falhar` só vale
   * no exemplo (o "Simular" da demo). Nada é gravado antes de o servidor aceitar.
   */
  function executar(falhar: boolean, chave: string, campos: Record<string, string>): Promise<ResultadoConfiguracao<object>> {
    const sim = { falhar, nome: antes.numero || NUMERO_EXEMPLO };
    if (tipo === "whats" && gateway) {
      if (soCampo) {
        // só a Meta troca um campo sozinho; na Zernio, a chave nova vai com o resto em branco (o
        // accountId é opcional: o servidor acha a conta) e a conexão é salva de novo
        if (gateway === "meta" || demo) {
          const campo = soCampo === "appSecret" || soCampo === "wabaId" ? soCampo : "token";
          return acoes.consertarCampo(campo, (campos[soCampo] ?? "").trim(), sim);
        }
        return acoes.salvarConexao(gateway, { [soCampo]: (campos[soCampo] ?? "").trim() }, sim);
      }
      return acoes.salvarConexao(gateway, campos, sim);
    }
    if (tipo === "chave" && motorEscolhido) {
      const modeloId = antes.modeloAtual ?? modelosDo(motorEscolhido.id).find((x) => x.recomendado)?.id ?? "";
      return acoes.salvarChave("resposta", motorEscolhido.id, modeloId, chave, sim);
    }
    if (tipo === "escuta" && transcritor) return acoes.salvarChave("transcricao", transcritor.id, transcritor.modelo, chave, sim);
    // a voz e o modelo de fala se escolhem na feature de uso: o modelo vai vazio (P1)
    if (tipo === "voz") return acoes.salvarChave("voz", PROVEDOR_VOZ.id, "", chave, sim);
    if (tipo === "motor" && motorEscolhido && etapa === "tudo" && modelo)
      return acoes.salvarChave("resposta", motorEscolhido.id, modelo, chave, sim);
    // provedor com a chave antes: confere a chave pedindo a lista de modelos (grava só no usarModelo)
    if (tipo === "motor" && motorEscolhido) return acoes.conferirChaveNova(motorEscolhido.id, chave, sim);
    return Promise.resolve({ ok: false, erro: "falha" });
  }

  /** O que a resposta aceita deixa na tela (o final da chave, a conexão salva, a lista de modelos). */
  function aceitar(r: { ok: true } & Record<string, unknown>, u4: string, chave: string) {
    const final = typeof r["ultimos4"] === "string" && r["ultimos4"] ? (r["ultimos4"] as string).toUpperCase() : u4;
    setUltimos4(final);
    // a pergunta sai da leitura do outro cartão de agora (a do clique em "Validar"): a cópia é no
    // servidor (acoes.usarChaveElevenLabs), e a chave daqui sai do campo logo abaixo
    if (chaveEleven) {
      const pergunta = tipo === "escuta" ? perguntaUsarNaVoz(voz, final) : perguntaUsarNaEscuta(esc, final);
      setTambem({
        pergunta,
        linha: tipo === "escuta" ? "A Voz da Janete já usa esta chave." : "A Escuta de áudio já usa esta chave.",
      });
      setErroCopia(null);
      setCopiou(false);
    }
    // a chave aceita sai do campo; o provedor com a chave antes a guarda só até gravar com o modelo
    if (tipo === "motor" && etapa === "chave") chaveConferida.current = chave;
    apagarChave();
    if (tipo === "whats" && !soCampo) {
      setDesativou(antes.wOk);
      if ("urlWebhook" in r) setSalva(r as unknown as ConexaoSalva);
    }
    if (tipo === "motor" && etapa === "chave" && Array.isArray(r["modelos"])) {
      const lst = r["modelos"] as ModeloListado[];
      aplicarLista(r as unknown as { ok: true } & ModelosDaChave, motorEscolhido?.id ?? null);
      // a escolha vale só se o modelo está na lista que a chave libera; senão, o recomendado
      if (lst.length) setModelo((m) => (lst.some((x) => x.id === m) ? m : (lst.find((x) => x.recomendado)?.id ?? lst[0]!.id)));
      return;
    }
    // a troca vale a partir daqui, feche o fluxo pelo botão, pelo Esc ou pelo Cancelar
    aoAplicado();
  }

  /** O foco no título do passo do QR, e depois o passo inteiro na vista. */
  const focarPassoQr = () => {
    focar("cfg-qr-titulo-fluxo", { atrasoMs: 20 });
    // depois do foco, rola o passo inteiro: o pé (linha viva e botão) entra na vista em
    // 1440×900, e o título continua visível
    depois(() => {
      const el = document.getElementById("cfg-qr-titulo-fluxo-passo");
      if (el && typeof el.scrollIntoView === "function")
        el.scrollIntoView({ block: "nearest", behavior: movimentoReduzido() ? "auto" : "smooth" });
    }, 80);
  };

  const validar = () => validarCom(campos);

  /**
   * Valida com estes campos. O "Usar o {número}" troca o número e valida na mesma hora: os campos
   * novos vêm por aqui, e não do estado (o fechamento ainda tem os velhos).
   */
  function validarCom(cs: Record<string, string>) {
    // do "qr" sai sozinho, quando o celular conecta (aoConectar do passo do QR)
    if (fase !== "form" && fase !== "erro" && fase !== "qr") return;
    if (fase === "form" && !podeValidar) return;
    const chave = lerChave();
    const falhar = demo && vaiDarErro(simular, chaveSoNoCampo ? [chave] : Object.values(cs));
    const u4 = ultimos4De(chave);
    // do passo do QR (o celular leu, ou o "Usar o …") ou do "Tentar de novo" depois de uma falha: a
    // mesma instância da tentativa anterior, e o celular que leu o QR desta troca continua valendo
    const mesmosDados = fase === "qr" || fase === "erro";
    setCampoErro(null);
    setAvisoErro(false);
    setDesdobra(false);
    setFalhou(null);
    setTambem(null);
    rodadaDesconectar.current += 1;
    setDiferente(null);
    setDesconectando(false);
    setErroDiferente(null);
    aoHero("carregando");
    val.validar<ResultadoConfiguracao<object>>({
      // um desconectar em curso termina antes: a instância ainda teria o celular errado
      chamar: () => {
        const antes = soltando.current;
        const rodar = () => executar(falhar, chave, cs);
        return antes ? antes.then(rodar) : rodar();
      },
      concluir: (d) => {
        const r: ResultadoConfiguracao<object> = d.tipo === "resposta" ? d.valor : { ok: false, erro: d.tipo === "sem_sessao" ? "sem_acesso" : "falha" };
        const lidoAntes = lidoAqui.current;
        lidoAqui.current = false;
        if (!r.ok) {
          const doQr = tipo === "whats" && !!gateway && ehGatewayQr(gateway) && !soCampo;
          // Z-API e Evolution com o número fora do celular: falta ler o QR code (nada foi gravado).
          // O herói continua "carregando" durante o passo.
          if (r.erro === "instancia_desconectada" && doQr && gateway && ehGatewayQr(gateway)) {
            qrDados.current = { gateway, campos: { ...cs } };
            // quem conectar daqui em diante lê o QR desta troca
            lidoAqui.current = true;
            setFalhou(null);
            focarPassoQr();
            return "qr";
          }
          // o celular de outro número leu o QR (nada foi gravado): o passo mostra os 2 números, com
          // "Usar o …" e "Desconectar e ler de novo" (spec-qr-whatsapp, seção 8, decisão 2)
          if (r.erro === "numero_diferente" && doQr && gateway && ehGatewayQr(gateway) && r.numeroConectado) {
            const n = normalizarNumero(cs["numero"] ?? "");
            qrDados.current = { gateway, campos: { ...cs } };
            // veio direto do "Conectar" (a instância já estava conectada): sair do aviso não desconecta
            lidoAqui.current = mesmosDados && lidoAntes;
            setFalhou(null);
            setDiferente({
              conectado: r.numeroConectado,
              informado: r.numeroInformado || (n ? formatarNumero(n) : (cs["numero"] ?? "").trim()),
            });
            focarPassoQr();
            return "qr";
          }
          // a falha no meio não apaga quem leu o QR desta troca: o "Tentar de novo" usa os mesmos dados
          lidoAqui.current = mesmosDados && lidoAntes;
          setFalhou(r);
          aoHero(null);
          // o botão pode nascer abaixo da dobra (1440×900): rola até ele junto com o foco
          focar("val-pri", { atrasoMs: 20, rolar: true });
          return "erro";
        }
        qrDados.current = null;
        aceitar(r as { ok: true } & Record<string, unknown>, u4, chave);
        aoHero("check");
        focar("val-pri", { atrasoMs: 20, rolar: true });
        return "ok";
      },
    });
  }

  /** O campo que a recusa marca: o que o gateway apontou, ou o padrão de cada um. */
  function campoDaFalha(): string {
    if (tipo !== "whats" || !gateway) return "chave";
    if (soCampo) return soCampo;
    const doServidor = falhou?.campo;
    if (doServidor && PROVS[gateway].campos.some((x) => x.id === doServidor)) return doServidor;
    return ERRO_GATEWAY[gateway].campo;
  }

  const corrigir = () => {
    if (fase !== "erro") return;
    // de volta ao formulário, os dados podem mudar: o próximo "Conectar" recomeça a conta
    lidoAqui.current = false;
    const campo = campoDaFalha();
    val.reabrir(() => {
      setCampoErro(campo);
      setAvisoErro(true);
      focar(idCampo(campo), { atrasoMs: 20 });
    });
  };

  // o passo do QR: pede a imagem com os campos lidos no "Conectar"; conectado, espera o quadro
  // voltar a ser o disco (tempoVoltaDisco) e valida de novo, que salva. Com o celular de outro
  // número, a leitura fica parada até "Desconectar e ler de novo".
  const validarRef = useRef(validar);
  validarRef.current = validar;
  const pararVoltaDisco = () => {
    if (voltaDisco.current) clearTimeout(voltaDisco.current);
    voltaDisco.current = null;
  };
  useEffect(() => {
    if (fase !== "qr") pararVoltaDisco();
  }, [fase]);
  useEffect(() => pararVoltaDisco, []);
  const leituraQr = useLeituraQr({
    ativo: fase === "qr" && !diferente,
    pedir: async (p) => {
      const d = qrDados.current;
      if (!d) return { ok: false, erro: "falha" };
      return respostaQr(await acoes.pedirQr(d.gateway, d.campos, p));
    },
    aoConectar: () => {
      pararVoltaDisco();
      voltaDisco.current = setTimeout(() => {
        voltaDisco.current = null;
        validarRef.current();
      }, tempoVoltaDisco());
    },
  });

  // "Usar o {número}": o número conectado entra no campo e a troca valida de novo com ele
  const usarConectado = () => {
    if (fase !== "qr" || !diferente || desconectando) return;
    const novos = { ...campos, numero: diferente.conectado };
    setCampos(novos);
    validarCom(novos);
  };

  // "Desconectar e ler de novo": tira o celular da instância; a leitura volta e pede um QR novo
  const desconectarDoQr = () => {
    const d = qrDados.current;
    if (fase !== "qr" || !diferente || desconectando || !d) return;
    const rodada = ++rodadaDesconectar.current;
    setDesconectando(true);
    setErroDiferente(null);
    const pedido = acoes.desconectarCelular(d.gateway, d.campos);
    // o próximo "Conectar" espera este desconectar, mesmo que a pessoa saia do aviso antes da resposta
    guardarSoltando(pedido);
    void pedido.then((r) => {
      if (!vivo.current || rodada !== rodadaDesconectar.current) return;
      setDesconectando(false);
      if (r.ok) {
        // quem conectar agora lê o QR desta troca
        lidoAqui.current = true;
        setDiferente(null);
        setErroDiferente(null);
        focar("cfg-qr-titulo-fluxo", { atrasoMs: 20 });
        return;
      }
      setErroDiferente(textoFalhaAcao(r.erro, r.mensagem));
      // o disabled do "Desconectando…" tirou o foco do botão: ele volta para lá, e não para o body
      focar("cfg-qr-titulo-fluxo-desconectar", { atrasoMs: 20 });
    });
  };

  /**
   * Sair do aviso do outro número sem escolher ("Corrigir os dados", "Cancelar", Esc ou sair da
   * Configuração) tira o celular errado da instância (spec-qr-whatsapp, seção 8, decisão 5), sem
   * esperar nem mostrar a resposta: a pessoa já saiu do aviso. Nenhuma falha escapa, nem a
   * síncrona: ela não pode cortar a saída no meio.
   */
  const soltarCelularErrado = () => {
    const d = qrDados.current;
    // só com o aviso na tela: depois do "Usar o …", o salvar já saiu com esse celular
    if (fase !== "qr" || !d || !diferente || desconectando || !lidoAqui.current) return;
    lidoAqui.current = false;
    guardarSoltando(
      new Promise((resolver) => resolver(acoes.desconectarCelular(d.gateway, d.campos))),
    );
  };
  const soltarRef = useRef(soltarCelularErrado);
  soltarRef.current = soltarCelularErrado;
  useEffect(() => () => soltarRef.current(), []);

  // "Corrigir os dados": volta ao formulário com os campos preenchidos
  const corrigirDoQr = () => {
    if (fase !== "qr") return;
    soltarCelularErrado();
    lidoAqui.current = false;
    qrDados.current = null;
    rodadaDesconectar.current += 1;
    setDiferente(null);
    setDesconectando(false);
    setErroDiferente(null);
    aoHero(null);
    val.reabrir(() => {
      const vazio = defs.find((d) => !d.opcional && !(campos[d.id] ?? "").trim());
      focar(vazio ? idCampo(vazio.id) : "cfg-acao-painel", { atrasoMs: 20 });
    });
  };

  const concluir = () => {
    let msg = "";
    if (tipo === "whats") msg = desativou ? "WhatsApp trocado. A conexão anterior foi desativada." : "WhatsApp conectado. A Janete voltou a atender.";
    else if (tipo === "chave") msg = antes.cerRemovida ? "Chave conectada. A Janete voltou a responder." : "Chave trocada. A antiga deixou de valer.";
    else if (tipo === "escuta") msg = "Escuta ligada. A Janete já entende os áudios.";
    else if (tipo === "voz") msg = "Voz conectada.";
    else if (tipo === "motor") msg = `A Janete passou a responder com o ${nomeDoModelo(modelo)}.`;
    chaveConferida.current = "";
    aoFechar("nasce");
    aoAvisar(msg);
  };

  // provedor com a chave antes: a chave aceita reabre o cartão com os modelos
  const irParaModelos = () => {
    val.reabrir(() => {
      setEtapa("modelos");
      setCarregando(true);
      setDesdobra(mov);
      depois(() => setDesdobra(false), 800);
      depois(() => setCarregando(false), mov ? 1200 : 200);
      focar("cfg-fluxo-titulo", { atrasoMs: 20 });
    });
  };

  // a chave da voz aceita (ou a da escuta, depois do "Sim") reabre o cartão com a lista de vozes
  // (como o motor segue para os modelos)
  const irParaVozes = () => {
    val.reabrir(() => {
      setEtapa("vozes");
      setDesdobra(mov);
      depois(() => setDesdobra(false), 800);
      focar("cfg-fluxo-titulo", { atrasoMs: 20 });
    });
  };

  const okContinuar = () => {
    if (fase !== "ok") return;
    if (tambem?.pergunta) usarTambem();
    else if (tipo === "motor" && etapa === "chave") irParaModelos();
    else if (tipo === "voz" && etapa === "chave") irParaVozes();
    else concluir();
  };

  // o "Sim" da pergunta: o servidor copia a chave deste cartão para o outro (a chave nunca volta à
  // tela); depois, a lista de vozes, nos dois fluxos (na escuta, E3). A falha fica na pergunta, com
  // os dois botões de volta (P9: o "Sim" tenta de novo).
  const usarTambem = () => {
    if (fase !== "ok" || copiando || !tambem?.pergunta) return;
    setCopiando(true);
    setErroCopia(null);
    void acoes.usarChaveElevenLabs(tipo === "escuta" ? "voz" : "transcricao").then((r) => {
      if (!vivo.current) return;
      setCopiando(false);
      if (!r.ok) {
        setErroCopia(textoFalhaAcao(r.erro, r.mensagem));
        // o disabled do "Sim" tirou o foco do botão: ele volta para lá, e não para o body
        focar("val-pri", { atrasoMs: 20 });
        return;
      }
      setCopiou(true);
      irParaVozes();
    });
  };

  // o "Não": na escuta, o fluxo conclui; na voz, segue para a lista de vozes, como sem pergunta
  const naoTambem = () => {
    if (fase !== "ok" || copiando) return;
    if (tipo === "voz") irParaVozes();
    else concluir();
  };

  /** A mensagem de fim da lista que vem depois de uma chave (a tabela de T6 da spec). No "Escolher
   *  depois" com a voz de antes ainda na conta, a mensagem diz que ela continua (equipe, 03/11). */
  function fimDaLista(salvou: boolean): string {
    const continua =
      !salvou && atualNaLista && prontaVozes?.atual ? `A Janete continua com a voz ${prontaVozes.atual.nome}.` : null;
    if (tipo === "escuta")
      return salvou
        ? "Escuta ligada e voz salva. As duas usam a mesma chave."
        : `Escuta ligada, e a voz usa a mesma chave. ${continua ?? "Escolha a voz no cartão Voz da Janete."}`;
    if (tipo === "voz" && copiou)
      return salvou
        ? "Voz salva. A escuta também usa esta chave."
        : `Voz conectada, e a escuta também usa esta chave. ${continua ?? "Escolha a voz quando quiser."}`;
    return salvou ? "Voz salva." : `Voz conectada. ${continua ?? "Escolha a voz quando quiser."}`;
  }

  // "Escolher depois": a chave já está gravada; o fluxo fecha sem voz escolhida
  const escolherDepois = () => {
    if (salvando || !listaAposChave) return;
    aoAplicado();
    aoFechar("nasce");
    aoAvisar(fimDaLista(false));
  };

  // grava a voz marcada (escolherVoz: o servidor confere na ElevenLabs e guarda o nome de lá)
  const usarVoz = () => {
    if (salvando || !valorVoz || !prontaVozes || mesmaVoz) return;
    const id = valorVoz;
    setSalvando(true);
    setVozSalvando(id);
    void comMinimo(acoes.escolherVoz(id), mov ? 700 : 100).then((r) => {
      if (!vivo.current) return;
      setSalvando(false);
      setVozSalvando(null);
      if (!r.ok) {
        aoAvisar(r.erro === "sem_acesso" ? "Só quem administra a conta escolhe a voz." : textoFalhaAcao(r.erro, r.mensagem), "info");
        return;
      }
      aoAplicado();
      aoFechar("nasce");
      aoAvisar(fimDaLista(true));
    });
  };

  function nomeDoModelo(id: string | null): string {
    if (!id || !item) return "modelo novo";
    return listaModelos?.find((x) => x.id === id)?.nome ?? modelosDo(item as Motor["id"]).find((x) => x.id === id)?.nome ?? id;
  }

  // trocar só o modelo (trocarModeloIA, com a chave guardada) ou gravar o cérebro novo com a chave
  // já conferida (salvarChaveIA): a validação de verdade é no servidor
  const usarModelo = () => {
    if (salvando || carregando || !modelo || !item) return;
    if (tipo === "modelo" && modelo === antes.modeloAtual) return;
    setSalvando(true);
    const provedor = item as Motor["id"];
    const escolhido = modelo;
    const pedido: Promise<ResultadoConfiguracao<object>> =
      tipo === "modelo"
        ? acoes.trocarModelo("resposta", escolhido)
        : acoes.salvarChave("resposta", provedor, escolhido, chaveConferida.current);
    void comMinimo(pedido, mov ? 700 : 100).then((r) => {
      if (!vivo.current) return;
      setSalvando(false);
      if (!r.ok) {
        aoAvisar(
          r.erro === "sem_acesso" ? "Só quem administra a conta troca o cérebro." : textoFalhaAcao(r.erro, r.mensagem),
          "info",
        );
        return;
      }
      chaveConferida.current = "";
      aoAplicado();
      aoFechar("nasce");
      aoAvisar(`A Janete passou a responder com o ${nomeDoModelo(escolhido)}.`);
    });
  };

  const acaoPainel = () => {
    if (naLista) usarVoz();
    else if (tipo === "modelo" || (tipo === "motor" && etapa === "modelos")) usarModelo();
    else validar();
  };

  const fechar = () => {
    if (travado) return;
    soltarCelularErrado();
    apagarChave();
    chaveConferida.current = "";
    aoFechar();
  };

  const tecla = (ev: KeyboardEvent<HTMLElement>) => {
    if (ev.key === "Escape" && !ev.defaultPrevented) {
      ev.preventDefault();
      fechar();
      return;
    }
    // no celular o fluxo é uma tela cheia modal: o Tab fica preso nele
    if (ev.key !== "Tab" || !telaCheia) return;
    const caixa = ev.currentTarget;
    const focaveis = Array.from(caixa.querySelectorAll<HTMLElement>(FOCAVEIS)).filter(
      (el) => !(el as HTMLButtonElement).disabled && !el.closest("[inert]"),
    );
    if (!focaveis.length) return;
    const primeiro = focaveis[0]!;
    const ultimo = focaveis[focaveis.length - 1]!;
    const ativo = document.activeElement;
    if (ev.shiftKey && (ativo === primeiro || ativo?.id === "cfg-fluxo-titulo")) {
      ev.preventDefault();
      ultimo.focus();
    } else if (!ev.shiftKey && ativo === ultimo) {
      ev.preventDefault();
      primeiro.focus();
    }
  };

  /* ---------- textos ---------- */

  const motorAtual = antes.motor;
  const titulo = {
    whats: antes.reconectar ? "Reconectar o WhatsApp" : "Trocar de WhatsApp",
    chave: `${antes.cerRemovida ? "Conectar uma chave" : "Trocar a chave"} ${deNome(motorAtual ?? motorEscolhido)}`.trim(),
    modelo: "Trocar o modelo",
    motor: "Trocar de provedor",
    escuta: antes.escOk ? "Trocar a escuta de áudio" : "Conectar a escuta de áudio",
    voz: antes.vozTem ? "Trocar a chave da ElevenLabs" : "Conectar a ElevenLabs",
    vozes: TITULO_VOZES,
  }[naLista ? "vozes" : tipo];
  const campoSo = soCampo && prov ? prov.campos.find((x) => x.id === soCampo) : null;
  const sub = {
    whats: campoSo
      ? `Cole só o campo "${campoSo.label}". Os outros dados da ${prov!.curto} continuam guardados.`
      : "Escolha como conectar e cole os dados do gateway. A validação confere tudo antes de ativar.",
    chave: `A chave nova é conferida com ${artigoNome(motorEscolhido)} antes de valer.`,
    modelo: `A lista vem agora ${deNome(motorEscolhido)}, com os modelos liberados para a sua chave.`,
    motor: "Troque o fabricante do cérebro. A chave nova é validada antes de a Janete mudar.",
    escuta: "Com uma chave de transcrição, os áudios dos leads viram texto e a Janete responde sozinha.",
    voz: "Com ela, a Janete responde por áudio e, sem outra chave que transcreva, também escuta os áudios dos leads. A chave é conferida antes de valer.",
    vozes: SUB_VOZES,
  }[naLista ? "vozes" : tipo];

  /* ---------- o painel ---------- */

  const salvar = tipo === "modelo" || (tipo === "motor" && etapa === "modelos") || naLista;
  let acaoTexto = "Validar a chave";
  if (tipo === "whats") acaoTexto = "Conectar";
  else if (tipo === "modelo") acaoTexto = "Salvar o modelo";
  else if (naLista) acaoTexto = "Salvar a voz";
  else if (tipo === "motor") acaoTexto = etapa === "modelos" ? "Usar este cérebro" : etapa === "tudo" ? "Validar e usar" : "Validar a chave";
  const acaoBloqueada = naLista
    ? salvando || !prontaVozes || !valorVoz || mesmaVoz
    : salvar
      ? salvando || carregando || !modelo || (tipo === "modelo" && modelo === antes.modeloAtual)
      : // fora do formulário (o disco, o resultado ou o passo do QR) o botão fica travado
        !podeValidar || (fase !== "form" && fase !== "erro");

  let info = "";
  if (tipo === "whats" && antes.wOk) info = `Ao conectar, o ${antes.numero} pela ${antes.curto} é desativado. Só um WhatsApp fica ativo por vez.`;
  if (tipo === "whats" && soCampo) info = "O endereço do webhook e os outros dados não mudam. Só este campo é conferido de novo.";
  if (tipo === "chave")
    info = antes.cerOk
      ? `Enquanto a chave nova não for validada, a terminada em ${antes.ultimos4} continua valendo.`
      : "A Janete volta a responder assim que uma chave for validada.";
  if (tipo === "motor" && etapa === "chave") info = `Primeiro a chave: a lista de modelos vem ${deNome(motorEscolhido)}, com o que essa chave libera.`;

  // a ElevenLabs (voz, ou escuta com ela) sem os acessos ou sem crédito (como no onboarding): a chave
  // está certa, então a frase do servidor (o que ligar, o que recarregar) vai para o título e para o
  // campo, no lugar do "Copie de novo"
  const recusaVoz = chaveEleven && (falhou?.erro === "sem_permissao" || falhou?.erro === "sem_credito");
  const partesVoz = recusaVoz ? separarMensagem(falhou?.mensagem ?? "") : null;
  const tituloRecusaVoz =
    partesVoz?.titulo || (falhou?.erro === "sem_credito" ? "A chave está sem crédito." : `${maiuscula(artigoNome(dono))} recusou a chave.`);
  // o WhatsApp: a frase do servidor (quando veio) vale sobre o texto fixo do gateway, que fica para
  // o exemplo; assim o nome, a URL e a chave global da Evolution aparecem com o motivo certo
  const partesWhats = tipo === "whats" && falhou?.mensagem ? separarMensagem(falhou.mensagem) : null;
  const erroCampoTexto =
    tipo === "whats" && gateway
      ? partesWhats
        ? partesWhats.texto || partesWhats.titulo
        : ERRO_GATEWAY[gateway].campoTexto
      : partesVoz
        ? partesVoz.texto || (falhou?.erro === "sem_permissao" ? ajudaEleven : tituloRecusaVoz)
        : "Chave recusada. Copie de novo, inteira, e valide.";
  const avisoErroTitulo =
    tipo === "whats" && gateway
      ? partesWhats?.titulo || ERRO_GATEWAY[gateway].titulo
      : partesVoz
        ? tituloRecusaVoz
        : `${maiuscula(artigoNome(dono))} recusou a chave.`;
  const avisoErroTexto = tipo === "whats" ? "Corrija o campo marcado e conecte de novo." : "Cole uma chave nova e valide de novo.";

  function inicioDono(): ReactNode {
    if (prov) return <LogoTile logo={prov.logo} alt={prov.logoAlt} escura={prov.escura} larga={prov.larga} />;
    if (transcritor)
      return transcritor.logo ? (
        <LogoTile logo={transcritor.logo} alt={transcritor.nome} />
      ) : (
        <span className={lista.logoTile} aria-hidden="true">
          <span className={c.cfMonoLogo}>G</span>
        </span>
      );
    if (motorEscolhido) return <LogoTile logo={motorEscolhido.logo} alt={motorEscolhido.nome} />;
    if (provVoz) return <LogoTile logo={provVoz.logo} alt={provVoz.nome} />;
    return null;
  }

  const nomeDono = prov?.nome ?? transcritor?.nome ?? motorEscolhido?.nome ?? provVoz?.nome ?? "";
  let fraseDono = prov?.linha ?? transcritor?.linha ?? motorEscolhido?.linha ?? provVoz?.linha ?? "";
  if (tipo === "chave") fraseDono = `Chave nova para o ${antes.nomeModelo || "modelo atual"}. O modelo continua o mesmo.`;
  if (tipo === "modelo") fraseDono = `Hoje a Janete usa o ${antes.nomeModelo || "modelo atual"}.`;
  if (naLista) fraseDono = antes.vozAtual ? `Hoje a Janete usa a voz ${antes.vozAtual.nome}.` : "A Janete ainda não tem voz escolhida.";
  // a lista de vozes da escuta vem depois da chave gravada: não há para onde voltar
  const temVoltar = !naLista && ((tipo === "whats" && !soCampo) || tipo === "motor" || tipo === "escuta");

  function modelosUI(): ReactNode {
    const m = motorEscolhido;
    if (!m) return null;
    const q = busca.trim().toLowerCase();
    // a lista do provedor (banco) ou a curada; o perfil, quando o provedor não manda, fica vazio
    const todos = listaModelos ?? modelosCurados(m.id);
    const perfilDe = (x: ModeloListado) => x.perfil ?? x.fabricante ?? "";
    const listaM = todos
      .filter((x) => !q || x.nome.toLowerCase().includes(q) || x.id.toLowerCase().includes(q) || perfilDe(x).toLowerCase().includes(q))
      .slice(0, MAX_MODELOS_NA_LISTA);
    const temSel = listaM.some((x) => x.id === modelo);
    return (
      <div className={lista.campoModelo}>
        <p className={lista.campoRotulo} id="cfg-rot-modelos">
          Modelo
        </p>
        {avisoLista && !carregando && (
          <p className={cx(lista.aviso, lista.avisoInfo)} role="status">
            <Icone d={ICX.info} />
            <span>{avisoLista}</span>
          </p>
        )}
        {m.busca && (
          <Campo
            id="cfg-busca-modelo"
            rotulo="Buscar modelo"
            rotuloOculto
            type="search"
            value={busca}
            placeholder="Buscar modelo, ex.: haiku"
            autoComplete="off"
            prefixo={<Icone d={IC.lupa} />}
            onChange={(ev) => setBusca(ev.target.value)}
          />
        )}
        {carregando ? (
          <div className={c.cfCarregandoModelos} aria-busy="true">
            <p className={c.cfConsultando} role="status">
              <JaneteSimbolo estado="carregando" tamanho={22} decorativo />
              <span>
                Buscando os modelos {m.artigo === "o" ? "no" : "na"} {m.nome}…
              </span>
            </p>
            <div className={c.cfOssos} aria-hidden="true">
              <span className={c.cfOsso} />
              <span className={c.cfOsso} />
              <span className={c.cfOsso} />
              <span className={c.cfOsso} />
            </div>
          </div>
        ) : (
          <div
            className={cx(lista.modelos, lista.duasColunas)}
            data-colunas="2"
            role="radiogroup"
            aria-labelledby="cfg-rot-modelos"
          >
            {!m.busca && listaM.length > 0 && (
              <p className={lista.modelosCab} aria-hidden="true">
                Preço em US$ por 1 milhão de tokens, entrada / saída
              </p>
            )}
            {listaM.map((md, i) => {
              const emUso = antes.provedorAtual === m.id && antes.modeloAtual === md.id;
              const ativo = md.id === modelo;
              const preco = m.busca ? "" : precoDe(md);
              return (
                <button
                  key={md.id}
                  type="button"
                  role="radio"
                  id={`cfg-md-${i}`}
                  className={cx(lista.modelo, ativo && lista.ativo)}
                  aria-checked={ativo}
                  tabIndex={ativo || (!temSel && i === 0) ? 0 : -1}
                  onClick={() => setModelo(md.id)}
                  onKeyDown={(ev) => {
                    let j = -1;
                    if (ev.key === "ArrowDown" || ev.key === "ArrowRight") j = (i + 1) % listaM.length;
                    else if (ev.key === "ArrowUp" || ev.key === "ArrowLeft") j = (i - 1 + listaM.length) % listaM.length;
                    if (j < 0) return;
                    ev.preventDefault();
                    setModelo(listaM[j]!.id);
                    focarAgora(`cfg-md-${j}`);
                  }}
                >
                  <span className={lista.radio} aria-hidden="true" />
                  <span className={lista.mdTexto}>
                    <span className={lista.mdNome}>
                      <span className={m.busca ? lista.mdId : undefined}>{md.nome}</span>
                      {emUso && (
                        <Selo variante="fato" compacto>
                          Em uso
                        </Selo>
                      )}
                      {md.recomendado && !emUso && <span className={lista.selo}>Recomendado para começar</span>}
                    </span>
                    <span className={lista.mdPerfil}>{perfilDe(md)}</span>
                  </span>
                  {preco && (
                    <span className={lista.mdPreco}>
                      <span className={lista.sr}>Preço por 1 milhão de tokens, entrada e saída: </span>
                      <span>{preco}</span>
                    </span>
                  )}
                </button>
              );
            })}
            {listaM.length === 0 && (
              <p className={lista.buscaVazia}>Nenhum modelo com esse nome. Tente &quot;haiku&quot;, &quot;gpt&quot; ou &quot;gemini&quot;.</p>
            )}
          </div>
        )}
      </div>
    );
  }

  const mostraModelos = tipo === "modelo" || (tipo === "motor" && (etapa === "modelos" || etapa === "tudo"));

  const painel = item ? (
    <div
      className={cx(lista.painel, c.cfPainel, (tipo === "chave" || tipo === "modelo" || tipo === "voz" || tipo === "vozes" || naLista) && c.cfSolto)}
      role="group"
      aria-label={nomeDono}
    >
      <div className={lista.painelCab}>
        {inicioDono()}
        <span className={lista.linhaTexto}>
          <span className={lista.linhaNome}>{nomeDono}</span>
          <span className={lista.linhaFrase}>{fraseDono}</span>
        </span>
        {temVoltar ? (
          <Botao variante="discreto" className={lista.btnC} icone={<Icone d={IC.chevronEsquerda} tamanho="p" />} onClick={voltarItem}>
            Voltar
          </Botao>
        ) : (
          <span />
        )}
      </div>
      {avisoErro && <AvisoErro titulo={avisoErroTitulo} texto={avisoErroTexto} />}
      {info && !avisoErro && (
        <p className={cx(lista.aviso, lista.avisoInfo)}>
          <Icone d={ICX.info} />
          <span>{info}</span>
        </p>
      )}
      {mostraModelos && modelosUI()}
      {naLista && (
        <ListaDeVozes
          estado={listaVozes.estado}
          valor={valorVoz}
          aoMudar={setVozMarcada}
          aoRecarregar={listaVozes.recarregar}
          ocupada={vozSalvando}
          rotulo="Vozes da conta da ElevenLabs"
          idBase="cfg-voz"
        />
      )}
      {defs.length > 0 && (
        <div className={lista.camposGrade} data-colunas="2">
          {defs.map((d) => {
            const domId = idCampo(d.id);
            const revelado = !!revelar[d.id];
            const temErro = campoErro === d.id;
            return (
              <Campo
                key={`${item}-${d.id}`}
                id={domId}
                className={cx(d.largo && lista.campoLargo, d.segredo && c.cfCampoSegredo)}
                rotulo={d.label}
                placeholder={d.ph}
                type={d.tel ? "tel" : d.segredo && !revelado ? "password" : "text"}
                {...(d.tel ? { inputMode: "tel" as const } : {})}
                {...(d.id === "chave" && chaveSoNoCampo ? {} : { value: campos[d.id] ?? "" })}
                onChange={(ev) => {
                  const v = ev.target.value;
                  if (d.id === "chave" && chaveSoNoCampo) {
                    const t = v.trim();
                    setMedidaChave({ tamanho: t.length, final: chaveTemFinal(t) });
                  } else setCampos((atual) => ({ ...atual, [d.id]: v }));
                  if (campoErro === d.id) setCampoErro(null);
                }}
                onKeyDown={(ev) => {
                  if (ev.key !== "Enter") return;
                  ev.preventDefault();
                  acaoPainel();
                }}
                autoComplete={d.tel ? "tel" : "off"}
                spellCheck={false}
                erro={temErro ? erroCampoTexto : undefined}
                dica={temErro ? undefined : d.ajuda}
                sufixo={
                  d.segredo ? (
                    <button
                      type="button"
                      className={lista.olhar}
                      aria-label={`${revelado ? "Ocultar" : "Mostrar"} ${d.label.toLowerCase()}`}
                      onClick={() => setRevelar((atual) => ({ ...atual, [d.id]: !atual[d.id] }))}
                    >
                      {revelado ? "Ocultar" : "Mostrar"}
                    </button>
                  ) : undefined
                }
              />
            );
          })}
        </div>
      )}
      {/* só a Meta pede para colar o endereço e o token: Zernio, Z-API e Evolution recebem sozinhos */}
      {gateway === "meta" && !soCampo && (
        <div className={lista.bloco}>
          <p className={lista.meta}>Gerado por nós. Depois de conectar, cole no painel da Meta.</p>
          <div className={lista.gerado}>
            <div className={lista.geradoTexto}>
              <span className={lista.geradoRotulo}>Endereço do webhook</span>
              <code className={cx(lista.geradoValor, c.cfGeradoValor, lista.mono)}>{urlWebhook("meta", "[id da nova conexão]")}</code>
            </div>
          </div>
          <div className={lista.gerado}>
            <div className={lista.geradoTexto}>
              <span className={lista.geradoRotulo}>Verify token</span>
              <span className={lista.geradoPendente}>Gerado ao conectar</span>
            </div>
          </div>
        </div>
      )}
      <div className={cx(lista.painelPe, c.cfPainelPe)}>
        {!salvar && demo && (
          <label className={c.cfSim} htmlFor="cfg-sim-fluxo">
            <input id="cfg-sim-fluxo" type="checkbox" checked={simular} onChange={(ev) => setSimular(ev.target.checked)} />
            <span>{tipo === "whats" ? "Simular dados recusados na demo" : 'Simular "chave inválida" na demo'}</span>
          </label>
        )}
        {/* a lista logo depois de uma chave: a chave já vale, a voz pode ficar para depois (P10) */}
        {listaAposChave && (
          <Botao id="cfg-vozes-depois" variante="contorno" disabled={salvando} onClick={escolherDepois}>
            Escolher depois
          </Botao>
        )}
        <Botao id="cfg-acao-painel" disabled={acaoBloqueada} carregando={salvando} onClick={acaoPainel} iconeDepois={<Icone d={IC.seta} />}>
          {salvando ? "Salvando…" : acaoTexto}
        </Botao>
      </div>
    </div>
  ) : null;

  /* ---------- a lista ---------- */

  // os selos ("Fácil", "Em uso") vão ao lado do nome, como no protótipo
  let itens: { id: string; nome: string; linha: string; inicio: ReactNode; selos?: ReactNode }[] = [];
  if (tipo === "whats" && modo) {
    itens = ORDEM_GATEWAYS.filter((g) => PROVS[g].modo === modo).map((g) => {
      const p = PROVS[g];
      const d = DIFICULDADE[p.dificuldade];
      const emUso = antes.wOk && w.conexao?.gateway === g;
      return {
        id: g,
        nome: p.nome,
        linha: p.linha,
        inicio: <LogoTile logo={p.logo} alt={p.logoAlt} escura={p.escura} larga={p.larga} />,
        selos: (
          <>
            <Selo compacto tom={d.tom}>
              <span className={lista.sr}>Dificuldade: </span>
              {d.rotulo}
            </Selo>
            {emUso && (
              <Selo variante="fato" compacto>
                Em uso
              </Selo>
            )}
          </>
        ),
      };
    });
  } else if (tipo === "motor") {
    itens = MOTORES.map((m) => ({
      id: m.id,
      nome: m.nome,
      linha: m.linha,
      inicio: <LogoTile logo={m.logo} alt={m.nome} />,
      selos:
        antes.provedorAtual === m.id ? (
          <Selo variante="fato" compacto>
            Em uso
          </Selo>
        ) : undefined,
    }));
  } else if (tipo === "escuta") {
    itens = TRANSCRITORES.map((t) => ({
      id: t.id,
      nome: t.nome,
      linha: t.linha,
      inicio: t.logo ? (
        <LogoTile logo={t.logo} alt={t.nome} />
      ) : (
        <span className={lista.logoTile} aria-hidden="true">
          <span className={c.cfMonoLogo}>G</span>
        </span>
      ),
      selos:
        antes.escProv === t.id ? (
          <Selo variante="fato" compacto>
            Em uso
          </Selo>
        ) : undefined,
    }));
  }
  const olhoItens = tipo === "whats" ? (modo === "oficial" ? "Pela API oficial" : "Pelo QR code") : tipo === "motor" ? "Qual motor a Janete vai usar?" : "Quem vai ouvir os áudios?";
  const modoObj = MODOS.find((m) => m.id === modo);

  /* ---------- o palco ---------- */

  const vis: Fase = fase === "reabrindo" ? (val.faseAntes ?? "ok") : fase;
  let ok = { estado: "Chave aceita", titulo: "", detalhe: "", sub: "A chave fica guardada com segurança e nunca é mostrada de novo.", acao: "Voltar para a Configuração" };
  if (tipo === "whats")
    ok = {
      estado: "Conectado",
      titulo: "Tudo certo, WhatsApp conectado.",
      detalhe: demo ? `Número de exemplo ${antes.numero || NUMERO_EXEMPLO}` : salva?.nome ? `Número ${salva.nome}` : antes.numero,
      sub: desativou
        ? "A conexão anterior foi desativada. A Janete já recebe as mensagens deste número."
        : "A Janete já recebe e responde as mensagens deste número.",
      acao: "Voltar para a Configuração",
    };
  else if (tipo === "chave") ok = { ...ok, titulo: "A Janete já usa a chave nova.", detalhe: `chave terminada em ${ultimos4}` };
  else if (tipo === "escuta")
    ok = { ...ok, titulo: "A Janete já entende áudios.", detalhe: `chave terminada em ${ultimos4}`, sub: "Os próximos áudios dos leads viram texto, e ela responde sozinha." };
  else if (tipo === "voz")
    ok = {
      ...ok,
      titulo: "A voz da Janete está conectada.",
      detalhe: `chave terminada em ${ultimos4}`,
      sub: "Agora escolha a voz que a Janete usa nos áudios. Sem voz, ela responde em texto.",
      acao: "Escolher a voz",
    };
  else if (tipo === "motor" && etapa === "chave")
    ok = {
      ...ok,
      titulo: "Agora escolha o modelo.",
      detalhe: `chave terminada em ${ultimos4}`,
      sub: `A lista vem ${deNome(motorEscolhido)}, com os modelos liberados para esta chave.`,
      acao: "Escolher o modelo",
    };
  else if (tipo === "motor") ok = { ...ok, titulo: "A Janete tem um cérebro novo.", detalhe: `${nomeDoModelo(modelo)} · chave terminada em ${ultimos4}` };

  // a recusa de verdade (falhou) escolhe o texto: a credencial recusada usa o texto de cada gateway
  // ou provedor; os outros códigos viram frase (textoFalhaAcao), com a frase do servidor por cima
  let erro: { estado: string; titulo: string; texto: string; corrigir: string };
  if (tipo === "whats" && gateway) {
    const e = ERRO_GATEWAY[gateway];
    const resto = antes.wOk ? " A conexão atual continua ativa." : "";
    // a credencial recusada: o título da frase do servidor (a 1ª frase), ou o fixo do gateway no exemplo
    const partes = falhou?.mensagem ? separarMensagem(falhou.mensagem) : null;
    erro =
      !falhou || falhou.erro === "credencial_invalida"
        ? {
            estado: "Não conectou",
            titulo: partes?.titulo || e.titulo,
            texto: (partes ? partes.texto : e.texto) + resto,
            corrigir: "Corrigir os dados",
          }
        : {
            estado: "Não conectou",
            titulo: falhou.erro === "sem_acesso" ? "Só quem administra a conta conecta o WhatsApp." : "Não deu para conectar.",
            texto: textoFalhaAcao(falhou.erro, falhou.mensagem) + resto,
            corrigir: "Corrigir os dados",
          };
  } else {
    let resto = "";
    if (tipo === "chave")
      resto = antes.cerOk ? ` A chave terminada em ${antes.ultimos4} continua valendo.` : " A Janete continua parada até uma chave ser aceita.";
    else if (tipo === "motor")
      resto = antes.cerOk ? ` O cérebro atual, ${antes.nomeModelo}, continua respondendo.` : " A Janete continua parada até uma chave ser aceita.";
    else if (tipo === "voz") resto = antes.vozOk ? " A chave atual da ElevenLabs continua valendo." : "";
    const recusada = !falhou || falhou.erro === "chave_invalida";
    erro = partesVoz
      ? {
          estado: "Chave recusada",
          titulo: tituloRecusaVoz,
          texto: `${partesVoz.texto}${resto}`.trim(),
          corrigir: "Corrigir a chave",
        }
      : recusada
      ? {
          estado: "Chave inválida",
          titulo: `${maiuscula(artigoNome(dono))} recusou a chave.`,
          texto: `${falhou?.mensagem ?? "Confira se você copiou a chave inteira, sem espaço no começo ou no fim."}${resto}`,
          corrigir: "Corrigir a chave",
        }
      : {
          estado: falhou.erro === "sem_credito" ? "Sem crédito" : "Não validou",
          titulo:
            falhou.erro === "sem_credito"
              ? "A chave está sem crédito."
              : falhou.erro === "sem_acesso"
                ? "Só quem administra a conta troca a chave."
                : `${maiuscula(artigoNome(dono))} não aceitou a chave agora.`,
          texto: `${textoFalhaAcao(falhou.erro, falhou.mensagem)}${resto}`,
          corrigir: "Corrigir a chave",
        };
  }

  // a conexão salva: os avisos (feito na prévia, webhook que o gateway não aceitou sozinho) e, na
  // Meta, o endereço e o token para colar no painel dela (decisão 14b)
  // "Copiado" só quando o navegador confirma a cópia; recusada, o valor continua à mostra
  const copiarF = (id: string, valor: string) => {
    let copia: Promise<void> | undefined;
    try {
      copia = navigator.clipboard?.writeText(valor);
    } catch {
      copia = undefined;
    }
    if (!copia) return;
    void copia.then(
      () => {
        setCopiadoF(id);
        depois(() => setCopiadoF((atual) => (atual === id ? null : atual)), 1800);
      },
      () => {},
    );
  };
  // e, no Trocar, o webhook da conexão antiga que ficou no provedor (decisão 10 das lacunas)
  const avisosSalva = salva
    ? [
        ...salva.avisos.map((a) => textoAvisoConexao(a, salva.gateway)),
        salva.anterior ? textoWebhookAnterior(salva.anterior.aviso, salva.anterior.gateway) : "",
      ].filter(Boolean)
    : [];
  const geradosSalva =
    salva && salva.urlWebhook && (salva.gateway === "meta" || salva.avisos.includes("webhook_nao_configurado"))
      ? [
          { id: "url", rotulo: "Endereço do webhook", valor: salva.urlWebhook },
          ...(salva.verifyToken ? [{ id: "verify", rotulo: "Verify token", valor: salva.verifyToken }] : []),
        ]
      : [];
  const extrasOk =
    tipo === "whats" && (avisosSalva.length > 0 || geradosSalva.length > 0) ? (
      <div className={cx(lista.bloco, lista.sobe, lista.d3)} data-testid="cfg-ok-conexao">
        {avisosSalva.map((t) => (
          <p key={t} className={cx(lista.aviso, lista.avisoInfo)}>
            <Icone d={ICX.info} />
            <span>{t}</span>
          </p>
        ))}
        {geradosSalva.length > 0 && (
          <p className={lista.meta}>
            {salva!.gateway === "meta" ? "Cole no painel da Meta, no campo do webhook." : `Cole no painel da ${prov?.curto ?? "provedora"}.`}
          </p>
        )}
        {geradosSalva.map((g) => {
          const feito = copiadoF === g.id;
          return (
            <div key={g.id} className={lista.gerado}>
              <div className={lista.geradoTexto}>
                <span className={lista.geradoRotulo}>{g.rotulo}</span>
                <code className={cx(lista.geradoValor, c.cfGeradoValor, lista.mono)}>{g.valor}</code>
              </div>
              <Botao
                variante="contorno"
                className={cx(lista.btnC, lista.btnCopiar, feito && lista.copiado)}
                icone={<Icone d={feito ? IC.feito : IC.copiar} tamanho="p" />}
                aria-label={feito ? `${g.rotulo} copiado` : `Copiar ${g.rotulo.toLowerCase()}`}
                onClick={() => copiarF(g.id, g.valor)}
              >
                {feito ? "Copiado" : "Copiar"}
              </Botao>
            </div>
          );
        })}
      </div>
    ) : null;

  const face = prov
    ? { logo: prov.logo, alt: prov.logoAlt, escura: prov.escura, larga: prov.larga }
    : transcritor
      ? { logo: transcritor.logo, alt: transcritor.nome }
      : motorEscolhido
        ? { logo: motorEscolhido.logo, alt: motorEscolhido.nome }
        : provVoz
          ? { logo: provVoz.logo, alt: provVoz.nome }
          : { logo: null, alt: "" };
  const classeFace = cx(lista.face, "escura" in face && face.escura && lista.escura, "larga" in face && face.larga && lista.larga);

  // anúncio para o leitor de tela
  let anuncio = "";
  if (fase === "verificando") anuncio = `Validando. ${passos[Math.min(val.passo, 2)] ?? ""}…`;
  else if (fase === "ok") anuncio = tambem?.pergunta ? `${ok.titulo} ${ok.detalhe} ${tambem.pergunta.titulo}` : `${ok.titulo} ${ok.detalhe}`;
  else if (fase === "erro") anuncio = erro.titulo;
  // os estados do passo (expirado, passkey…) a linha viva do PassoQr anuncia
  // o celular de outro número tem o anúncio próprio (como o ANUNCIO_DIFERENTE do onboarding)
  else if (fase === "qr")
    anuncio = diferente
      ? "O celular conectado é de outro número."
      : "Falta ler o QR code com o WhatsApp do celular.";
  const gatewayQr = gateway && ehGatewayQr(gateway) ? gateway : null;
  // o número informado, formatado, no passo 1 do QR ("Abra o WhatsApp no celular do +55 11 …")
  const numeroNormal = gatewayQr ? normalizarNumero(campos["numero"] ?? "") : null;
  const numeroQr = numeroNormal ? formatarNumero(numeroNormal) : undefined;

  const secao = (
    <section
      id="cfg-fluxo"
      className={cx(lista.secao, c.cfFluxo)}
      role={telaCheia ? "dialog" : "region"}
      aria-modal={telaCheia || undefined}
      data-cheia={telaCheia || undefined}
      aria-labelledby="cfg-fluxo-titulo"
      data-validando={fase !== "form" || undefined}
      data-fluxo={tipo}
      onKeyDown={tecla}
    >
      <div className={c.cfFluxoTopo}>
        <h2 id="cfg-fluxo-titulo" tabIndex={-1} className={c.cfFluxoTitulo}>
          {titulo}
        </h2>
        <Botao
          id="cfg-fluxo-cancelar"
          variante="contorno"
          className={lista.btnC}
          icone={<Icone d={ICX.fechar} tamanho="p" />}
          disabled={travado}
          onClick={fechar}
        >
          Cancelar
        </Botao>
      </div>
      <p className={c.cfFluxoSub}>{sub}</p>
      <div className={lista.listaPalco}>
        <span id="disco-mira" className={lista.discoMira} aria-hidden="true" />
        <div className={lista.listaSombra}>
          <div
            id="cfg-lista-cartao"
            tabIndex={-1}
            data-fase={fase}
            className={cx(lista.lista, fechada && lista.fechada, sob && lista.sob, desdobra && lista.desdobrando)}
          >
            <div className={lista.listaIn} aria-hidden={fechada || undefined} inert={fechada || val.preparando || undefined}>
              {tipo === "whats" && (
                <>
                  <Dobra aberta={!modo}>
                    <h3 className={lista.listaOlho}>Como você quer conectar?</h3>
                  </Dobra>
                  <ul>
                    {MODOS.map((m) => (
                      <Dobra key={m.id} as="li" aberta={!modo}>
                        <Linha
                          id={`cfg-modo-${m.id}`}
                          inicio={
                            <span className={lista.linhaIcone} aria-hidden="true">
                              <Icone d={m.icone} tamanho="g" />
                            </span>
                          }
                          nome={m.titulo}
                          frase={m.linha}
                          extra={
                            <span className={lista.estadoLinha} data-tom={m.estadoClasse}>
                              <Icone d={m.estadoIcone} tamanho="p" />
                              <span>{m.selo}</span>
                            </span>
                          }
                          aoEscolher={() => escolherModo(m.id)}
                        />
                      </Dobra>
                    ))}
                  </ul>
                  <Dobra aberta={!!modo}>
                    <div className={lista.linhaResumo}>
                      <span className={cx(lista.linhaIcone, lista.p)} aria-hidden="true">
                        <Icone d={modoObj?.icone ?? ""} />
                      </span>
                      <span className={lista.linhaTexto}>
                        <span className={lista.meta}>Modo de conexão</span>
                        <span className={lista.resumoNome}>{modoObj?.resumo ?? ""}</span>
                      </span>
                      <Botao variante="discreto" className={lista.btnC} onClick={trocarModo} icone={<Icone d={IC.chevronEsquerda} tamanho="p" />}>
                        Trocar modo
                      </Botao>
                    </div>
                  </Dobra>
                </>
              )}
              {itens.length > 0 && (
                <>
                  <Dobra aberta={!item}>
                    <h3 id="cfg-olho-itens" tabIndex={-1} className={cx(lista.listaOlho, tipo === "whats" && lista.apos)}>
                      {olhoItens}
                    </h3>
                  </Dobra>
                  <ul>
                    {itens.map((it) => (
                      <Dobra key={it.id} as="li" aberta={!item}>
                        <LinhaFluxo
                          id={`cfg-it-${it.id}`}
                          inicio={it.inicio}
                          nome={it.nome}
                          frase={it.linha}
                          selos={it.selos}
                          aoEscolher={() => escolherItem(it.id)}
                        />
                      </Dobra>
                    ))}
                  </ul>
                </>
              )}
              <Dobra aberta={!!item}>{painel}</Dobra>
            </div>
          </div>
        </div>

        {/* o palco da validação (o PalcoValidacao do onboarding, com o monograma da Groq) */}
        {(sob || fase === "fechando") && (
          <div
            className={lista.val}
            data-fase={fase}
            data-vis={vis}
            data-gira={fase === "verificando" || undefined}
            data-reabrindo={fase === "reabrindo" || undefined}
          >
            <div className={lista.valAncora}>
              <div className={lista.disco} data-testid="cfg-val-disco">
                <div className={lista.moeda}>
                  <div className={classeFace}>
                    {face.logo ? <img src={face.logo} alt={face.alt} /> : <span className={c.cfMonoLogo} data-grande="" role="img" aria-label={face.alt}>G</span>}
                  </div>
                  <div className={cx(classeFace, lista.verso)} aria-hidden="true">
                    {face.logo ? <img src={face.logo} alt="" /> : <span className={c.cfMonoLogo} data-grande="">G</span>}
                  </div>
                </div>
                <svg className={lista.discoCheck} viewBox="0 0 112 112" aria-hidden="true">
                  <path d="M37 57l13 13 26-28" />
                </svg>
                <svg className={lista.discoAlerta} viewBox="0 0 112 112" aria-hidden="true">
                  <path d="M56 36v26" />
                  <circle cx="56" cy="76" r="4" />
                </svg>
              </div>
            </div>
            <div className={lista.valTexto}>
              {fase === "verificando" && (
                <ol className={lista.verif} aria-hidden="true">
                  {passos.map((texto, i) => (
                    <li
                      key={texto}
                      className={lista.verifItem}
                      data-estado={i < val.passo ? "feito" : i === val.passo ? "ativo" : "pendente"}
                    >
                      <span className={lista.verifGlifo} />
                      <span>{texto}</span>
                    </li>
                  ))}
                </ol>
              )}
              {vis === "ok" && (
                <div className={lista.okBloco}>
                  <p className={cx(lista.estadoLinha, lista.sobe)} data-tom="ok">
                    <Icone d={IC.ok} tamanho="p" />
                    <span>{ok.estado}</span>
                  </p>
                  <h3 className={cx(lista.hDestaque, lista.sobe, lista.d1)}>{ok.titulo}</h3>
                  <p className={cx(lista.okDetalhe, lista.mono, lista.sobe, lista.d2)}>{ok.detalhe}</p>
                  <p className={cx(lista.okSub, lista.sobe, lista.d3)}>{ok.sub}</p>
                  {extrasOk}
                  {/* a chave da ElevenLabs: a pergunta "usar também no outro cartão?" ou, quando o
                      outro já usa a mesma chave (P6), a linha que diz isso */}
                  {tambem?.pergunta ? (
                    // o lista.okExtra põe o palco no fluxo da página (Lista.module.css, ".listaPalco:has(.okExtra)"):
                    // com a pergunta e os dois botões, o resultado passa dos 36rem do cartão por baixo e os
                    // botões saíam do fim da página; o texto continua centrado, como no resto do bloco
                    // (os parágrafos têm largura máxima: o alignItems os põe no meio, não na esquerda)
                    <div
                      className={cx(lista.bloco, lista.okExtra, lista.sobe, lista.d3)}
                      style={{ textAlign: "center", alignItems: "center" }}
                      data-testid="cfg-ok-tambem"
                    >
                      <p className={lista.okSub}>
                        <strong>{tambem.pergunta.titulo}</strong>
                      </p>
                      <p className={lista.okSub}>{tambem.pergunta.detalhe}</p>
                      {erroCopia && (
                        <p className={cx(lista.aviso, lista.avisoErro)} role="alert">
                          <Icone d={IC.triangulo} />
                          <span>{erroCopia}</span>
                        </p>
                      )}
                    </div>
                  ) : (
                    tambem && <p className={cx(lista.okSub, lista.sobe, lista.d3)}>{tambem.linha}</p>
                  )}
                  <div className={cx(lista.okAcoes, lista.sobe, lista.d4)}>
                    <Botao
                      id="val-pri"
                      tamanho="grande"
                      disabled={copiando}
                      carregando={copiando}
                      onClick={okContinuar}
                      iconeDepois={<Icone d={IC.seta} />}
                    >
                      {tambem?.pergunta ? tambem.pergunta.sim : ok.acao}
                    </Botao>
                    {tambem?.pergunta && (
                      <Botao id="val-sec" variante="contorno" tamanho="grande" disabled={copiando} onClick={naoTambem}>
                        {tambem.pergunta.nao}
                      </Botao>
                    )}
                  </div>
                </div>
              )}
              {vis === "qr" && gatewayQr && (
                <PassoQr
                  estado={leituraQr.estado}
                  gateway={gatewayQr}
                  variante="palco"
                  nivel={3}
                  idTitulo="cfg-qr-titulo-fluxo"
                  numero={numeroQr}
                  diferente={
                    diferente
                      ? {
                          conectado: diferente.conectado,
                          informado: diferente.informado,
                          aoUsar: usarConectado,
                          aoDesconectar: desconectarDoQr,
                          desconectando,
                          erro: erroDiferente,
                        }
                      : undefined
                  }
                  aoGerarOutro={leituraQr.gerarOutro}
                  acoes={
                    <Botao variante="contorno" onClick={corrigirDoQr}>
                      Corrigir os dados
                    </Botao>
                  }
                />
              )}
              {vis === "erro" && (
                <div className={cx(lista.okBloco, lista.erroBloco)} role="alert">
                  <p className={cx(lista.estadoLinha, lista.sobe)} data-tom="erro">
                    <Icone d={IC.triangulo} tamanho="p" />
                    <span>{erro.estado}</span>
                  </p>
                  <h3 className={cx(lista.hDestaque, lista.sobe, lista.d1)}>{erro.titulo}</h3>
                  <p className={cx(lista.okSub, lista.sobe, lista.d2)}>{erro.texto}</p>
                  <div className={cx(lista.okAcoes, lista.sobe, lista.d3)}>
                    <Botao id="val-pri" onClick={corrigir}>
                      {erro.corrigir}
                    </Botao>
                    <Botao variante="contorno" onClick={validar}>
                      Tentar de novo
                    </Botao>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <p className={c.cfSr} role="status" aria-live="polite">
        {anuncio}
      </p>
    </section>
  );

  // no celular, a tela cheia vai para o <body>: fica acima do dock e do botão da Janete, fora do
  // empilhamento do <main>. O contêiner leva a identidade para herdar a fonte e a cor.
  if (telaCheia && typeof document !== "undefined") return createPortal(<div data-identidade="aipro">{secao}</div>, document.body);
  return secao;
}
