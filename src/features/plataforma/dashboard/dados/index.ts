// A fundação do Dashboard (docs/spec-dashboard.md, seção 14): as versões importam daqui e só leem
// `usePainelDashboard()`. Nada aqui é da versão: os números, as frases e as formatações são comuns.
export * from "./tipos";
export * from "./formatar";
export { ProvedorPainel, usePainelDashboard, useEstadoPainel, ATRASO_CARREGANDO_MS } from "./ProvedorPainel";
export {
  montarPainel,
  montarPainelBanco,
  calcularDadosPeriodo,
  dadosDoBanco,
  contextoDoBanco,
  janelasDashboard,
  CONTEXTO_EXEMPLO,
  saudacao,
  type DadosPeriodo,
  type DefEtapaFunil,
  type EntradaPainel,
  type EntradaPainelBanco,
} from "./montar";
export { montarPeriodo, MAX_DIAS_PERSONALIZADO } from "./periodo";
export { DIAS_SEM_RESPOSTA } from "./gerador";

import { idTituloArea } from "../../AreaVazia";

/**
 * O id do h1 (a saudação) de toda versão. A casca (Layout.tsx) põe o foco em `idTituloArea(área)`
 * quando um atalho da Janete abre o Dashboard e na chegada; como o h1 do Dashboard é a saudação, e não
 * a `VistaArea`, a versão usa este id. Regra das versões: `<h1 id={ID_TITULO_DASHBOARD}
 * tabIndex={-1}>` com a saudação, e a raiz com `aria-labelledby={ID_TITULO_DASHBOARD}` e
 * `data-area="dashboard"`.
 */
export const ID_TITULO_DASHBOARD = idTituloArea("dashboard");
