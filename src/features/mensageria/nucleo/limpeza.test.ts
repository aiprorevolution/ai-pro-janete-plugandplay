// Contrato entre limparPayload e os adaptadores: o ciclo reprocessa eventos pendentes a partir
// do corpo GRAVADO (limpo). Para cada gateway, traduzir() tem de dar o mesmo resultado com o
// corpo original e com o limpo, mesmo quando o envelope traz chaves secretas e segredos.
import { describe, expect, it } from "vitest";
import { adaptadorEvolution } from "../gateways/evolution";
import { adaptadorMeta } from "../gateways/meta";
import { adaptadorZapi } from "../gateways/zapi";
import { adaptadorZernio } from "../gateways/zernio";
import { CHAVES_SECRETAS, limparPayload } from "./limpeza";
import type { AdaptadorGateway, ConexaoServidor } from "./tipos";

const TOKEN_URL = "tok-url-de-exemplo-0123456789abcdef";

type Caso = { nome: string; a: AdaptadorGateway; c: ConexaoServidor; corpos: unknown[] };

const evolution: ConexaoServidor = {
  id: "11111111-1111-4111-8111-111111111111",
  gateway: "evolution",
  id_externo: "vendas-01",
  parametros: { serverUrl: "https://evo.exemplo.com.br" },
  segredos: { apiKey: "chave-de-exemplo-9876", tokenUrl: TOKEN_URL },
  oficial: false,
};
const envelopeEvolution = (message: Record<string, unknown>, id: string) => ({
  event: "messages.upsert",
  instance: "vendas-01",
  apikey: "chave-de-exemplo-9876",
  destination: `https://app.exemplo.com.br/api/webhook/evolution/x?t=${TOKEN_URL}`,
  server_url: "https://evo.exemplo.com.br",
  data: {
    key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id },
    pushName: "Maria",
    messageTimestamp: 1761660000,
    instanceId: "uuid-exemplo",
    message,
  },
  sender: "5511888888888@s.whatsapp.net",
});

const zapi: ConexaoServidor = {
  id: "c1",
  gateway: "zapi",
  id_externo: "INST123",
  parametros: {},
  segredos: {
    instanceToken: "tok-instancia-x-0001",
    clientToken: "cli-token-y-0002",
    tokenUrl: "url-token-z-0003",
  },
  oficial: false,
};
const recebidaZapi = (extra: Record<string, unknown>) => ({
  type: "ReceivedCallback",
  instanceId: "INST123",
  messageId: "MSG1",
  phone: "5544999999999",
  senderLid: "81896604192873@lid",
  fromMe: false,
  momment: 1632228638000,
  status: "RECEIVED",
  chatName: "Fulano Exemplo",
  senderName: "Fulano Exemplo",
  isGroup: false,
  isNewsletter: false,
  isEdit: false,
  ...extra,
});

const NUMERO = "106540352242922";
const meta: ConexaoServidor = {
  id: "11111111-1111-4111-8111-111111111111",
  gateway: "meta",
  id_externo: NUMERO,
  parametros: { phoneId: NUMERO },
  segredos: {
    token: "TOKEN_DE_TESTE_0001",
    appSecret: "SEGREDO_DE_TESTE_0002",
    verifyToken: "VERIFICA_TESTE_0003",
  },
  oficial: true,
};
const corpoMeta = (msg: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "15550783881", phone_number_id: NUMERO },
            contacts: [{ profile: { name: "Pessoa Exemplo" }, wa_id: "16505551234" }],
            messages: [{ from: "16505551234", id: "wamid.AAA", timestamp: "1749416383", ...msg }],
          },
        },
      ],
    },
  ],
});

const zernio: ConexaoServidor = {
  id: "11111111-2222-3333-4444-555555555555",
  gateway: "zernio",
  id_externo: "acc_1",
  parametros: {},
  segredos: { apiKey: "sk_chave_de_teste_0000", webhookSecret: "segredo-de-teste-webhook" },
  oficial: true,
};
const entradaZernio = (msg: Record<string, unknown>) => ({
  id: "evt-1",
  event: "message.received",
  timestamp: "2026-10-28T13:00:00Z",
  secret: "segredo-de-teste-webhook",
  account: { accountId: "acc_1", profileId: "prof_1" },
  conversation: { id: "conv_1", participantId: "5511999998888", participantName: "Ana Exemplo" },
  message: {
    id: "m_1",
    conversationId: "conv_1",
    platform: "whatsapp",
    platformMessageId: "wamid.AAA",
    direction: "incoming",
    attachments: [],
    sender: { id: "5511999998888", phoneNumber: "+5511999998888", name: "Ana Exemplo" },
    sentAt: "2026-10-28T12:59:58Z",
    ...msg,
  },
});

const casos: Caso[] = [
  {
    nome: "evolution",
    a: adaptadorEvolution,
    c: evolution,
    corpos: [
      envelopeEvolution({ conversation: "Oi, quero saber o preço" }, "TXT1"),
      envelopeEvolution({ imageMessage: { mimetype: "image/jpeg", caption: "olha" } }, "IMG1"),
      envelopeEvolution({ audioMessage: { mimetype: "audio/ogg; codecs=opus" } }, "AUD1"),
    ],
  },
  {
    nome: "zapi",
    a: adaptadorZapi,
    c: zapi,
    corpos: [
      recebidaZapi({ text: { message: "oi" } }),
      recebidaZapi({
        image: { imageUrl: "https://f.z-api.io/i.jpg", mimeType: "image/jpeg", caption: "olha" },
      }),
      {
        type: "MessageStatusCallback",
        status: "READ",
        ids: ["MSG1"],
        phone: "5544999999999",
        momment: 1632228638000,
      },
    ],
  },
  {
    nome: "meta",
    a: adaptadorMeta,
    c: meta,
    corpos: [
      corpoMeta({ type: "text", text: { body: "oi" } }),
      corpoMeta({ type: "image", image: { id: "MID2", mime_type: "image/jpeg", caption: "x" } }),
    ],
  },
  {
    nome: "zernio",
    a: adaptadorZernio,
    c: zernio,
    corpos: [
      entradaZernio({ text: "oi" }),
      entradaZernio({
        attachments: [{ type: "image", mimeType: "image/jpeg", payload: { id: "md2" } }],
      }),
    ],
  },
];

describe("limparPayload x traduzir (reprocessamento pelo ciclo)", () => {
  for (const { nome, a, c, corpos } of casos) {
    it(`${nome}: traduzir dá o mesmo com o corpo original e com o limpo`, () => {
      for (const corpo of corpos) {
        const original = a.traduzir(corpo, c);
        const limpo = limparPayload(corpo, Object.values(c.segredos));
        expect(original.length).toBeGreaterThan(0);
        expect(original.every((e) => e.tipo === "ignorar")).toBe(false);
        expect(a.traduzir(limpo, c)).toEqual(original);
      }
    });
  }

  it("o corpo limpo não guarda nenhuma chave secreta nem segredo da conexão", () => {
    for (const { c, corpos } of casos) {
      for (const corpo of corpos) {
        const texto = JSON.stringify(limparPayload(corpo, Object.values(c.segredos)));
        for (const s of Object.values(c.segredos)) expect(texto).not.toContain(s);
        for (const k of CHAVES_SECRETAS) expect(texto.toLowerCase()).not.toContain(`"${k}":`);
      }
    }
  });
});
