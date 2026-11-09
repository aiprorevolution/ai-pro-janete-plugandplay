import type {
  CamposContato,
  CamposEtapa,
  ChaveIA,
  Conexao,
  Conversa,
  Etapa,
  Membro,
  NovaMensagem,
} from "../exemplo/tipos";
import type { ConfiguracaoDados, Eu, Leitura, OndeVisto, PendenciasMotor, Resultado, VersaoContextoBanco } from "./tipos";

// O contrato da camada de dados (spec 2.1, fonte.ts): o que toda tela lê e faz, igual no banco e no
// exemplo. As ações são as do exemplo (AcoesExemplo) sem reagir, simularJanete, recomecar e
// alternarSimulacao, agora assíncronas; as de Configuração e Equipe ficam nas funções de servidor
// de cada área (spec 2.4).

/** Uma mensagem nova da tela: a do exemplo, mais o arquivo de verdade (anexo ou áudio gravado). */
export type NovaMensagemDados = NovaMensagem & { arquivo?: Blob | undefined };

export interface AcoesDados {
  enviarMensagem(conversaId: string, m: NovaMensagemDados): Promise<Resultado>;
  assumir(conversaId: string): Promise<Resultado>;
  devolverParaJanete(conversaId: string): Promise<Resultado>;
  /** Também pede o "lido" no WhatsApp (decisão 6). */
  marcarLida(conversaId: string): Promise<Resultado>;
  tentarDeNovo(mensagemId: string): Promise<Resultado>;
  moverEtapa(contatoId: string, etapaId: string): Promise<Resultado>;
  editarContato(contatoId: string, campos: CamposContato): Promise<Resultado>;
  editarEtapa(etapaId: string, campos: CamposEtapa): Promise<Resultado>;
  reordenarEtapas(ids: string[]): Promise<Resultado>;
  apagarContato(contatoId: string): Promise<Resultado>;
  /** Devolve, em `valor`, o "visto em" gravado (ISO). */
  marcarVisto(onde: OndeVisto): Promise<Resultado<string>>;
}

export type NomeAcao = keyof AcoesDados;

/**
 * Os nomes das ações, para conferir em teste que cada uma tem a sua linha em INVALIDA. O
 * `satisfies` quebra o tsc se uma ação nova entrar em AcoesDados sem entrar aqui.
 */
const TODAS = {
  enviarMensagem: true,
  assumir: true,
  devolverParaJanete: true,
  marcarLida: true,
  tentarDeNovo: true,
  moverEtapa: true,
  editarContato: true,
  editarEtapa: true,
  reordenarEtapas: true,
  apagarContato: true,
  marcarVisto: true,
} as const satisfies Record<NomeAcao, true>;

export const NOMES_ACOES = Object.keys(TODAS) as NomeAcao[];

export interface FonteDados {
  /** Quem está usando. Garantido dentro de /app (a rota carrega antes). */
  useEu(): Eu;
  /** Inclui os inativos. */
  useMembros(): Leitura<Membro[]>;
  /** Inclui as arquivadas, na ordem. */
  useEtapas(): Leitura<Etapa[]>;
  /** A conexão com `ativa` (nula = nenhuma). Colunas listadas, nunca select('*'). */
  useConexaoAtiva(): Leitura<Conexao | null>;
  useConfiguracao(): Leitura<ConfiguracaoDados>;
  /**
   * O que o motor tem para fazer (motor_pendencias, spec-motor-acordado), só quando a leitura vale:
   * sem erro e com menos de 2 min. Undefined sem leitura que valha, e sempre no modo exemplo.
   */
  useMotor(): PendenciasMotor | undefined;
  /** A versão mais recente do Contexto (nula = o onboarding ainda não gravou nenhuma). */
  useContextoAtual(): Leitura<VersaoContextoBanco | null>;
  /** "Precisam de você": sem paginação, a mesma regra de `estaAguardando`, a que espera há mais tempo primeiro. */
  useAguardando(): Leitura<Conversa[]>;
  /** As chaves de IA (o atendente recebe []). */
  useChaves(): Leitura<ChaveIA[]>;
  acoes: AcoesDados;
}
