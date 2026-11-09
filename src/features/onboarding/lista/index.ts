// Peças comuns às etapas conexão e cérebro: no F as duas usam o mesmo cartão em acordeão
// ("1 e 2 · A lista") e o mesmo palco da validação (E4).
export * from "./dados";
export { s } from "./estilos";
export { AvisoErro, BotaoCompacto, Dobra, Icone, Linha, LogoTile, OutrosRodape, PainelCab, type PropsLogo } from "./pecas";
export {
  ListaDeVozes,
  MENSAGEM_SEM_VOZES,
  SeletorVoz,
  useListaVozes,
  type EstadoListaVozes,
  type PropsListaDeVozes,
} from "./SeletorVoz";
export { BlocoOk, CartaoLista, PalcoValidacao, type EntradaCartao, type ErroPalco } from "./CartaoLista";
export { consumirDesdobra, desdobraPedido, pedirDesdobra } from "./passagem";
export { lerCampo, limparCampo } from "./campos";
export { irParaEntrar, sessaoTerminou } from "./sessao";
export { focarAgora, useDepois } from "./useDepois";
export { usePainelMontado } from "./usePainelMontado";
export { esperaAteParada, trazerCartao, useValidacao, type Desfecho, type Validacao } from "./useValidacao";
