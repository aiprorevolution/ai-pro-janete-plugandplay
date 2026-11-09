// O modo exemplo das telas da plataforma (plano das telas, "Contratos"): os tipos, os dados
// fictícios, o reducer puro, as leituras comuns e o provedor com useExemplo().
export * from "./tipos";
export { IDS, criarEstadoInicial, idContato, idConversa, previaDoBanco } from "./dados";
export { LIMITES_RITMO, MAX_NOME_ETAPA, reduzir, type Reduzido } from "./reducer";
export * from "./regras";
export { PASSOS_DO_ENVIO, ProvedorExemplo, useExemplo } from "./ProvedorExemplo";
export { useTelaEstreita } from "./telaEstreita";
