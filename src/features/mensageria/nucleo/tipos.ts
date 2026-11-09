// Contratos da mensageria (docs/spec-mensageria-janete.md, seção "Contratos"). Tipos puros: nada
// aqui roda no navegador nem toca no banco. Os formatos batem com os parâmetros das funções do
// banco (registrar_entrada, registrar_saida_celular, atualizar_status).

export const GATEWAYS_MENSAGERIA = ["meta", "zernio", "zapi", "evolution"] as const;
export type GatewayId = (typeof GATEWAYS_MENSAGERIA)[number];

export type TipoIdentificador = "telefone" | "bsuid" | "lid" | "zernio_conversa";
export type Identificador = { tipo: TipoIdentificador; valor: string };

export type TipoMensagem =
  "texto" | "imagem" | "audio" | "video" | "documento" | "figurinha" | "outro";

/** Mesmos campos do p_msg do banco. momento em ISO 8601. */
export type MensagemNormalizada = {
  id_externo: string;
  id_gateway?: string;
  tipo: TipoMensagem;
  texto?: string;
  momento: string;
  midia_ref_externa?: string;
  midia_mime?: string;
  midia_nome?: string;
  midia_tamanho?: number;
  editada?: boolean;
  apagada?: boolean;
  /**
   * Citação: o id_externo da mensagem que esta responde, no formato do gateway (o mesmo que o
   * tradutor põe em id_externo). O banco acha a mensagem pela mesma conexão e grava
   * responde_a_id; quando não acha, fica nulo. Vazio = sem citação.
   */
  responde_a_id_externo?: string;
};

export type StatusGateway = "enviada" | "entregue" | "lida" | "falhou";

/** O que um webhook do gateway vira depois de traduzido. Um corpo pode trazer vários. */
export type Evento =
  | { tipo: "entrada"; ids: Identificador[]; nome_whatsapp?: string; msg: MensagemNormalizada }
  | { tipo: "saida_celular"; ids: Identificador[]; msg: MensagemNormalizada }
  | { tipo: "status"; id: string; status: StatusGateway; momento: string }
  | { tipo: "conexao"; status: "conectada" | "desconectada" | "erro"; detalhe?: string }
  | { tipo: "ignorar"; motivo: string };

/** Conexão carregada no servidor. Os segredos já vêm decifrados e nunca saem do servidor. */
export type ConexaoServidor = {
  id: string;
  gateway: GatewayId;
  id_externo: string;
  parametros: Record<string, unknown>;
  segredos: Record<string, string>;
  oficial: boolean;
};

/** Nomes fixos dos segredos de cada gateway (spec, premissas). */
export const NOMES_SEGREDOS: Record<GatewayId, readonly string[]> = {
  meta: ["token", "appSecret", "verifyToken"],
  zernio: ["apiKey", "webhookSecret"],
  zapi: ["instanceToken", "clientToken", "tokenUrl"],
  evolution: ["apiKey", "tokenUrl"],
};

/** Segredos que nós geramos (32 bytes aleatórios) e que o admin pode ver de novo. */
export const SEGREDOS_GERADOS = ["verifyToken", "webhookSecret", "tokenUrl"] as const;
export type SegredoGerado = (typeof SEGREDOS_GERADOS)[number];

/** Falha de chamada ao gateway. definitivo = não adianta tentar de novo. */
export class ErroGateway extends Error {
  readonly codigo: string;
  readonly definitivo: boolean;
  constructor(codigo: string, definitivo: boolean, mensagem?: string) {
    super(mensagem ?? codigo);
    this.name = "ErroGateway";
    this.codigo = codigo;
    this.definitivo = definitivo;
  }
}

export type PedidoEnvio = {
  destino: Identificador[];
  tipo: "texto" | "imagem" | "audio" | "documento";
  texto?: string;
  midia?: { url: string; mime: string; nome?: string };
  /**
   * Chave de idempotência (o id da mensagem no banco). Quem aceita (Zernio: Idempotency-Key)
   * não envia de novo quando o mesmo pedido é repetido; os outros ignoram.
   */
  chave?: string;
  /**
   * Qual tentativa é esta (1 = a primeira), como o pegar_envios contou. Ausente = primeira. A
   * Zernio usa para saber se um 422 da Idempotency-Key quer dizer "já saiu numa tentativa
   * anterior" (ERRO_ENVIO_INCERTO).
   */
  tentativa?: number;
  /**
   * O erro que a tentativa anterior deixou na linha (mensagens.erro, como o pegar_envios a
   * devolveu), ou ausente. Diz se o pedido anterior pode ter sido aceito: a Zernio só trata o 422
   * da Idempotency-Key como "pode já ter saído" quando o anterior não foi uma resposta de erro dela.
   */
  erroAnterior?: string | null;
  /**
   * Citação: o id_externo (no formato do gateway) da mensagem citada, da mesma conexão.
   * null ou ausente = mensagem sem citação. O adaptador manda como resposta a ela. Se o gateway
   * recusar, o ciclo manda de novo sem a citação (o adaptador não repete por conta própria).
   */
  respondeA?: string | null;
};

/**
 * Código de ErroGateway do envio que pode já ter chegado ao lead (não definitivo). O ciclo não
 * chama falhar_envio: deixa "enviando" para o pegar_envios decidir pelo eco do gateway.
 */
export const ERRO_ENVIO_INCERTO = "envio_incerto";

/**
 * Mensagens a marcar como lidas no WhatsApp: o destino e os ids externos delas.
 * ids_externos: só ids de mensagens de ENTRADA (do lead), em ordem de tempo, da mais antiga à
 * mais nova. Cada adaptador conta com isso: a Meta marca pelo último id (se for de saída, ela
 * recusa), a Evolution manda todos com fromMe:false e a Z-API pega os 20 últimos.
 */
export type RefLida = { destino: Identificador[]; ids_externos: string[] };

export type MidiaBaixada = { bytes: Uint8Array; mime: string; nome?: string };

/** Um por gateway, em src/features/mensageria/gateways/<gateway>/index.ts. */
export interface AdaptadorGateway {
  readonly gateway: GatewayId;
  /** Confere a origem (HMAC, token na URL ou cabeçalho). corpoCru é o texto antes do JSON. */
  validarWebhook(req: Request, corpoCru: string, c: ConexaoServidor): Promise<boolean>;
  /** Só a Meta: responde ao GET de verificação (hub.challenge). null = não é verificação. */
  responderVerificacao?(url: URL, c: ConexaoServidor): Response | null;
  /** Só a Zernio: id do evento para não processar duas vezes. */
  idEvento?(req: Request, corpo: unknown): string | null;
  /**
   * Nunca lança erro: o que não entende vira { tipo: "ignorar" }.
   * O ciclo pode chamar de novo com o corpo GRAVADO em eventos_webhook, que passou por
   * limparPayload (nucleo/limpeza.ts): sem as chaves de CHAVES_SECRETAS ("token", "apikey",
   * "secret"...) e com todo segredo da conexão trocado por "[removido]". Não leia essas
   * chaves nem dependa de texto com segredo, senão a segunda passada traduz diferente.
   */
  traduzir(corpo: unknown, c: ConexaoServidor): Evento[];
  /**
   * opcoes.fimEm: prazo absoluto da chamada do worker (nucleo/prazo.ts). O download desiste
   * antes dele, com ErroGateway("tempo_esgotado", false).
   */
  baixarMidia(ref: string, c: ConexaoServidor, opcoes?: { fimEm?: number }): Promise<MidiaBaixada>;
  /**
   * Falha = ErroGateway. O pedido tem o teto de tempoEnvio (nucleo/prazo.ts): 10 s para texto e
   * 20 s para mídia. opcoes.fimEm: prazo absoluto do worker; o pedido nunca passa do corte
   * (fimEm + 5 s) menos a reserva do concluir_envio. O ciclo só chama enviar quando o teto
   * inteiro cabe, para o corte da rota nunca pegar um envio já aceito pelo gateway.
   */
  enviar(
    p: PedidoEnvio,
    c: ConexaoServidor,
    opcoes?: { fimEm?: number },
  ): Promise<{ id_externo?: string; id_gateway?: string }>;
  /** Melhor esforço: nunca lança erro. Usado pela Janete antes de responder. */
  marcarLidaEDigitando(p: RefLida, c: ConexaoServidor): Promise<void>;
  /**
   * Só o "lido" (o lead vê o azul), sem "digitando": é o que a tela pede quando uma pessoa abre
   * ou mexe na conversa (decisão 6). Opcional: sem ele, a conversa não é marcada no WhatsApp.
   * Melhor esforço: nunca lança erro. opcoes.fimEm: prazo absoluto; o pedido desiste antes.
   * Devolve true só quando o gateway aceitou o pedido (2xx); false quando não pediu nada (sem
   * id, sem destino que o gateway aceite, sem prazo) ou o pedido falhou.
   */
  marcarLida?(ref: RefLida, c: ConexaoServidor, opcoes?: { fimEm?: number }): Promise<boolean>;
  /** Z-API, Evolution e Zernio: aponta o webhook do gateway para a nossa URL. */
  configurarWebhook?(c: ConexaoServidor, url: string): Promise<void>;
  /**
   * Evolution e Zernio: desliga o nosso webhook no gateway, sem desparear o número (o Desconectar
   * chama antes de desativar a conexão, que apaga os segredos). Meta e Z-API não têm: a API não
   * permite, e a tela lembra de tirar no painel. Falha = erro lançado; quem chama trata como
   * melhor esforço.
   */
  desligarWebhook?(c: ConexaoServidor): Promise<void>;
  /**
   * Converte os campos do formulário em id_externo, parametros e segredos. Os segredos que nós
   * geramos chegam prontos em `gerados` (só os do gateway).
   */
  montarConexao(
    campos: Record<string, string>,
    gerados: Partial<Record<SegredoGerado, string>>,
  ): { id_externo: string; parametros: Record<string, unknown>; segredos: Record<string, string> };
}
