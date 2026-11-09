import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useConta } from "../../conta";
import { useDashboardBanco, useEstadoEmMemoria, type DashboardPeriodoBanco } from "../../dados/dashboard";
import { MOTOR_VALE_MS } from "../../dados/motor";
import { useDados, useModoDados } from "../../dados/ProvedorDados";
import { usePapel } from "../../papel";
import { calcularDadosPeriodo, dadosDoBanco, janelasDashboard, montarPainel, montarPainelBanco, saudacao } from "./montar";
import { montarPeriodo } from "./periodo";
import type {
  EstadoPainelDashboard,
  IdPeriodo,
  PainelDashboard,
  Periodo,
  ResultadoSetPeriodo,
  Simulacao,
  ValorPainelDashboard,
} from "./tipos";

// O estado do painel (docs/spec-dashboard.md, seção 14): o período (padrão 30 dias), a simulação
// (padrão normal) e o "carregando" ao trocar o período. Fica acima da tela.
//
// Dois modos, pela camada de dados (useModoDados):
// - banco (spec de ligar as telas ao banco, task C4): os números vêm das funções dashboard_* pelas
//   leituras de dados/dashboard.ts (o período e o anterior "na mesma idade", o custo, os problemas
//   e o "agora"), e a Saúde da conexão, das chaves, do Contexto atual e da configuração. Relê no foco
//   e a cada 60 s. Ao trocar o período, os números de antes ficam (em "carregando") até os novos
//   chegarem; se a leitura do novo período falha, a última passada boa fica (com o aviso compacto e
//   o seletor). Enquanto nada chegou, ou se a 1ª leitura falhou, a tela mostra os 3 estados
//   (useEstadoPainel);
// - exemplo (os testes): o gerador do período e o "agora" do estado em memória, com as simulações e o
//   "carregando" simulado de 400 ms ao trocar o período. O cálculo pesado (o gerador) só refaz quando
//   muda o período ou o minuto do relógio; o "agora" refaz à parte, para assumir uma conversa no Chat
//   mudar o Dashboard na hora sem recalcular o histórico.

const PainelContexto = createContext<ValorPainelDashboard | null>(null);
const EstadoContexto = createContext<EstadoPainelDashboard | null>(null);

/** Quanto tempo o período "carrega" ao trocar, no modo exemplo (spec 10). */
export const ATRASO_CARREGANDO_MS = 400;
/** De quanto em quanto tempo o relógio do painel anda (o "atualizado às" e os "há X min"). */
export const INTERVALO_RELOGIO_MS = 60_000;
/**
 * Por quanto tempo a configuração lida vale para a Saúde falar do motor (ela é relida a cada 60 s):
 * mais velha que isto, ou com a releitura em erro, a Saúde não afirma nada sobre ele. É a mesma
 * validade da leitura do motor (MOTOR_VALE_MS, dados/motor.ts).
 */
export const CONFIGURACAO_VALE_MS = MOTOR_VALE_MS;

const CHAVE_VISTO = "janete-dashboard-visto";

function lerVisto(): boolean {
  try {
    return window.sessionStorage.getItem(CHAVE_VISTO) === "1";
  } catch {
    return false;
  }
}

function gravarVisto() {
  try {
    window.sessionStorage.setItem(CHAVE_VISTO, "1");
  } catch {
    // sem sessionStorage (aba privada, bloqueado): toda montagem conta como a 1ª
  }
}

interface Props {
  children: ReactNode;
  /** O relógio (testes fixam). Padrão: `new Date()`. */
  relogio?: (() => Date) | undefined;
  /** Período de partida. Padrão: 30 dias. */
  periodoInicial?: IdPeriodo | undefined;
  /** Simulação de partida (só o modo exemplo). Padrão: normal. */
  simulacaoInicial?: Simulacao | undefined;
}

export function ProvedorPainel(props: Props) {
  // O modo não muda durante a vida do provedor: trocar de componente aqui não quebra a ordem dos hooks.
  return useModoDados() === "banco" ? <ProvedorPainelBanco {...props} /> : <ProvedorPainelExemplo {...props} />;
}

/* ---------- o que os dois modos têm igual: o relógio, o período escolhido e a 1ª vez ---------- */

function useBasePainel({ relogio, periodoInicial = "30d", simulacaoInicial = "normal" }: Omit<Props, "children">, atrasoSimulado: boolean) {
  const relogioRef = useRef(relogio ?? (() => new Date()));
  relogioRef.current = relogio ?? (() => new Date());

  const [agoraMs, setAgoraMs] = useState(() => relogioRef.current().getTime());
  const [escolha, setEscolha] = useState<{ id: IdPeriodo; personalizado: { inicio: string; fim: string } | null }>(() => ({
    id: periodoInicial === "personalizado" ? "30d" : periodoInicial,
    personalizado: null,
  }));
  const escolhaRef = useRef(escolha);
  escolhaRef.current = escolha;
  const [simulacao, setSimulacao] = useState<Simulacao>(simulacaoInicial);
  const [carregandoTroca, setCarregandoTroca] = useState(false);
  // 1ª vez da aba: decidida na montagem (no StrictMode o inicializador roda duas vezes antes do efeito gravar).
  const [primeiraVez] = useState(() => !lerVisto());

  useEffect(() => {
    gravarVisto();
  }, []);

  // o relógio anda de minuto em minuto (só troca o estado quando o instante mudou)
  useEffect(() => {
    const id = setInterval(() => setAgoraMs(relogioRef.current().getTime()), INTERVALO_RELOGIO_MS);
    return () => clearInterval(id);
  }, []);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const periodo = useMemo(() => {
    const r = montarPeriodo(escolha.id, agoraMs, escolha.personalizado ?? undefined);
    if (r.ok) return r.periodo;
    // um personalizado que deixou de valer (o dia virou e o fim ficou no futuro não acontece; por garantia): 30 dias
    const padrao = montarPeriodo("30d", agoraMs);
    if (!padrao.ok) throw new Error("Período padrão inválido");
    return padrao.periodo;
  }, [escolha, agoraMs]);

  const setPeriodo = useCallback(
    (id: IdPeriodo, personalizado?: { inicio: string; fim: string }): ResultadoSetPeriodo => {
      const agora = relogioRef.current().getTime();
      const r = montarPeriodo(id, agora, id === "personalizado" ? personalizado : undefined);
      if (!r.ok) return r;
      const novo = { id, personalizado: id === "personalizado" && personalizado ? { ...personalizado } : null };
      const antes = escolhaRef.current;
      const mudou =
        antes.id !== novo.id ||
        antes.personalizado?.inicio !== novo.personalizado?.inicio ||
        antes.personalizado?.fim !== novo.personalizado?.fim;
      if (mudou) {
        escolhaRef.current = novo;
        setEscolha(novo);
        setAgoraMs(agora);
        if (atrasoSimulado) {
          setCarregandoTroca(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            timer.current = null;
            setCarregandoTroca(false);
          }, ATRASO_CARREGANDO_MS);
        }
      }
      return { ok: true };
    },
    [atrasoSimulado],
  );

  return { relogioRef, agoraMs, escolha, periodo, setPeriodo, simulacao, setSimulacao, carregandoTroca, primeiraVez };
}

function Provedores({ valor, estado, children }: { valor: ValorPainelDashboard | null; estado: EstadoPainelDashboard; children: ReactNode }) {
  return (
    <EstadoContexto.Provider value={estado}>
      <PainelContexto.Provider value={valor}>{children}</PainelContexto.Provider>
    </EstadoContexto.Provider>
  );
}

/* ---------- o modo exemplo ---------- */

function ProvedorPainelExemplo({ children, ...opcoes }: Props) {
  const estado = useEstadoEmMemoria();
  const { papel } = usePapel();
  const conta = useConta();
  const base = useBasePainel(opcoes, true);
  const { agoraMs, periodo, simulacao, carregandoTroca, escolha, setPeriodo, setSimulacao, primeiraVez } = base;

  const dados = useMemo(() => calcularDadosPeriodo(periodo, agoraMs), [periodo, agoraMs]);
  const carregando = carregandoTroca || simulacao === "carregando";

  const painel = useMemo(
    () => montarPainel({ estado, papel, nomeConta: conta.nome, agora: agoraMs, periodo, simulacao, carregando, dados }),
    [estado, papel, conta.nome, agoraMs, periodo, simulacao, carregando, dados],
  );

  const valor = useMemo<ValorPainelDashboard>(
    () => ({ painel, carregando, idPeriodo: escolha.id, setPeriodo, simulacao, setSimulacao, primeiraVez }),
    [painel, carregando, escolha.id, setPeriodo, simulacao, setSimulacao, primeiraVez],
  );
  const estadoLeitura = useMemo<EstadoPainelDashboard>(
    () => ({ pronto: true, erro: null, tentarDeNovo: () => {}, saudacao: painel.textos.saudacao }),
    [painel.textos.saudacao],
  );

  return (
    <Provedores valor={valor} estado={estadoLeitura}>
      {children}
    </Provedores>
  );
}

/* ---------- o modo banco ---------- */

function ProvedorPainelBanco({ children, ...opcoes }: Props) {
  const { papel } = usePapel();
  const admin = papel === "admin";
  const conta = useConta();
  const fonte = useDados();
  const base = useBasePainel(opcoes, false);
  const { relogioRef, agoraMs, periodo, escolha, setPeriodo, simulacao, setSimulacao, primeiraVez } = base;

  const conexao = fonte.useConexaoAtiva();
  const chaves = fonte.useChaves();
  const contexto = fonte.useContextoAtual();
  // O motor (motor_pendencias), relido a cada 60 s e no foco; só vem a leitura sem erro e recente.
  const motor = fonte.useMotor();

  // A chave é o período na tela (o id e os dias); as janelas saem do relógio na hora de cada busca.
  const lido = useDashboardBanco<Periodo>({
    chave: [periodo.id, periodo.inicio, periodo.fim],
    admin,
    janelas: () => janelasDashboard(periodo, relogioRef.current().getTime()),
    contexto: periodo,
  });
  // A configuração (o onboarding e o sinal do motor) relida a cada 60 s e no foco, pela leitura do Dashboard.
  const configuracao = lido.configuracao;
  // Só afirma algo do motor com uma leitura sem erro e recente: o dado velho que o React Query mantém
  // depois de uma releitura que falhou (ou que não chegou) não serve para dizer "a Janete está atrasada".
  // Avaliado a cada render (o relógio do painel anda de minuto em minuto).
  const configuracaoValida =
    configuracao.dados && configuracao.erro === null && Date.now() - configuracao.chegouEm < CONFIGURACAO_VALE_MS ? configuracao.dados : undefined;

  // A última passada boa: se a leitura de um período novo falha (sem nada para mostrar), a tela
  // continua com ela, o aviso compacto e o seletor, em vez de ficar presa no erro desse período.
  const ultimaBoaRef = useRef<DashboardPeriodoBanco<Periodo> | null>(null);
  if (lido.periodo.dados) ultimaBoaRef.current = lido.periodo.dados;
  const dadosPeriodo = lido.periodo.dados ?? (lido.periodo.erro !== null ?(ultimaBoaRef.current ?? undefined) : undefined);
  const leituraPeriodo = { ...lido.periodo, dados: dadosPeriodo };
  const dados = useMemo(() => (dadosPeriodo ? dadosDoBanco(dadosPeriodo) : null), [dadosPeriodo]);
  const carregando = lido.periodo.atualizando;

  // As leituras sem as quais a tela não monta (a configuração e o motor, não: sem eles, só não se fala do motor).
  const necessarias = [leituraPeriodo, lido.agora, conexao, contexto, ...(admin ? [chaves] : [])];
  const pronto = necessarias.every((l) => l.dados !== undefined);
  const erro = necessarias.find((l) => l.erro !== null)?.erro ?? null;
  const tentarDeNovoRef = useRef<() => void>(() => {});
  tentarDeNovoRef.current = () => {
    for (const l of necessarias) if (l.erro !== null) l.tentarDeNovo();
    if (configuracao.erro !== null) configuracao.tentarDeNovo();
  };
  const tentarDeNovo = useCallback(() => tentarDeNovoRef.current(), []);

  const agoraBanco = lido.agora.dados;
  const conexaoDados = conexao.dados;
  const chavesDados = chaves.dados;
  const contextoDados = contexto.dados;
  const configuracaoDados = configuracaoValida;
  // a última lida, mesmo velha: só o onboarding concluído vale dela (o atraso não some do Dashboard)
  const configuracaoConhecida = configuracao.dados;

  const painel = useMemo<PainelDashboard | null>(() => {
    if (!dadosPeriodo || !dados || !agoraBanco || conexaoDados === undefined || contextoDados === undefined) return null;
    if (admin && chavesDados === undefined) return null;
    return montarPainelBanco({
      papel,
      nomeConta: conta.nome,
      agora: agoraMs,
      periodo: dadosPeriodo,
      dados,
      agoraBanco,
      conexao: conexaoDados,
      chaves: chavesDados ?? [],
      configuracao: configuracaoDados,
      configuracaoConhecida,
      motor,
      contexto: contextoDados,
      carregando,
    });
  }, [dadosPeriodo, dados, agoraBanco, conexaoDados, contextoDados, chavesDados, configuracaoDados, configuracaoConhecida, motor, admin, papel, conta.nome, agoraMs, carregando]);

  const valor = useMemo<ValorPainelDashboard | null>(
    () => (painel ? { painel, carregando, idPeriodo: escolha.id, setPeriodo, simulacao, setSimulacao, primeiraVez } : null),
    [painel, carregando, escolha.id, setPeriodo, simulacao, setSimulacao, primeiraVez],
  );
  const textoSaudacao = saudacao(agoraMs, conta.nome);
  const estadoLeitura = useMemo<EstadoPainelDashboard>(
    () => ({ pronto: pronto && !!painel, erro, tentarDeNovo, saudacao: textoSaudacao }),
    [pronto, painel, erro, tentarDeNovo, textoSaudacao],
  );

  return (
    <Provedores valor={valor} estado={estadoLeitura}>
      {children}
    </Provedores>
  );
}

/** O painel do Dashboard. Só dentro do `ProvedorPainel` (o `TelaDashboard` põe), e só com `useEstadoPainel().pronto`. */
export function usePainelDashboard(): ValorPainelDashboard {
  const valor = useContext(PainelContexto);
  if (!valor) throw new Error("usePainelDashboard() precisa do <ProvedorPainel> em volta (o TelaDashboard põe) e do painel pronto.");
  return valor;
}

/** Os 3 estados da leitura do painel (carregando, erro, pronto). Só dentro do `ProvedorPainel`. */
export function useEstadoPainel(): EstadoPainelDashboard {
  const valor = useContext(EstadoContexto);
  if (!valor) throw new Error("useEstadoPainel() precisa do <ProvedorPainel> em volta (o TelaDashboard põe).");
  return valor;
}
