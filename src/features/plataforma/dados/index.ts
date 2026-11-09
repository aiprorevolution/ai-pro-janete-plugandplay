// A camada de dados da plataforma (spec de ligar as telas ao banco, 2.1): uma fonte só, em React
// Query, no lugar das 3 fontes do exemplo. As telas leem e agem por `useDados()`.
export * from "./tipos";
export { CODIGOS_DO_BANCO, SemLinhas, exigirLinhas, recusado, traduzirErro } from "./erros";
export { CHAVES, INVALIDA, POR_TABELA, TABELAS_DA_ACAO, raizesDaTabela, type ChaveRaiz, type Tabela } from "./chaves";
export { NOMES_ACOES, type AcoesDados, type FonteDados, type NomeAcao, type NovaMensagemDados } from "./fonte";
export * from "./colunas";
export {
  RELER_SEM_TEMPO_REAL_MS,
  REPETIR_LEITURA_VEZES,
  repetirSoFalha,
  carregarEu,
  filtrarAguardando,
  opcoesAguardando,
  opcoesChaves,
  opcoesConexaoAtiva,
  opcoesConfiguracao,
  opcoesContextoAtual,
  opcoesEtapas,
  opcoesEu,
  opcoesMembros,
} from "./leituras";
export {
  ProvedorDados,
  conferirAntesDoArquivo,
  conversaEmCache,
  criarAcoesBanco,
  lerConversaAntes,
  limparCamposContato,
  limparCamposEtapa,
  useClienteDados,
  useDados,
  useModoDados,
  type PropsProvedorDados,
  type ServidorDados,
} from "./ProvedorDados";
export {
  AssinanteTempoReal,
  NOME_CANAL,
  TABELAS_TEMPO_REAL,
  TABELAS_TEMPO_REAL_HOJE,
  TABELAS_TEMPO_REAL_PACOTE,
  JUNTAR_AVISOS_MS,
  aplicarMudanca,
  criarJuntador,
  relerAberto,
  removerPorId,
  type AvisoMudanca,
  type JuntadorAvisos,
} from "./tempoReal";
export { Carregando, ErroLeitura, Vazio, textoDoErro, type FormaCarregando } from "./estados";
export { ehUuid, useAbrirPorId, type OpcoesAbrirPorId, type SituacaoAbrir } from "./abrirPorId";
export {
  CACHE_LINK_MS,
  VALIDADE_LINK_S,
  caminhosProntos,
  situacaoDaMidia,
  useUrlMidia,
  type SituacaoMidia,
  type UrlsMidia,
} from "./midia";
export {
  BUCKET_MIDIAS,
  assumePorEnvio,
  caminhoDaMidia,
  criarEnviador,
  type ConversaAntes,
  type DepsEnvio,
  type Enviador,
  type RespostaServidor,
} from "./envio";
export { paraLeitura, pronta } from "./leitura";
export {
  CONSERTAR_APOS_MS,
  CONSERTAR_A_CADA_MS,
  MOTOR_VALE_MS,
  lerPendencias,
  motorValido,
  opcoesMotor,
  quandoConsertar,
  useConsertoDoMotor,
} from "./motor";
export {
  MAX_CUSTO_POR_CHAMADA,
  TAMANHO_PAGINA_MENSAGENS,
  ProvedorLeiturasConversa,
  criarLeiturasConversaBanco,
  criarLeiturasConversaExemplo,
  juntarPaginas,
  lerAnotacoesJanete,
  opcoesContato,
  opcoesConversa,
  opcoesConversaDoContato,
  opcoesCustoConversas,
  opcoesEventos,
  opcoesHistoricoContato,
  opcoesMensagens,
  useContato,
  useConversa,
  useConversaDoContato,
  useCustoConversas,
  useEventos,
  useHistoricoContato,
  useMensagens,
  type LeiturasConversa,
} from "./conversa";
