// Adaptador provisório: ocupa o lugar de um gateway até o workflow dele preencher a pasta.
// Recusa todo webhook e falha todo envio de forma definitiva, para nada sair por engano.
import { ErroGateway, type AdaptadorGateway, type GatewayId } from "../nucleo/tipos";

export function adaptadorProvisorio(gateway: GatewayId): AdaptadorGateway {
  const naoFeito = () => new ErroGateway("gateway_nao_implementado", true);
  return {
    gateway,
    async validarWebhook() {
      return false;
    },
    traduzir() {
      return [{ tipo: "ignorar", motivo: "gateway_nao_implementado" }];
    },
    async baixarMidia() {
      throw naoFeito();
    },
    async enviar() {
      throw naoFeito();
    },
    async marcarLidaEDigitando() {},
    montarConexao() {
      throw naoFeito();
    },
  };
}
