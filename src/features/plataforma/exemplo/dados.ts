import { MODO_VOZ_PADRAO, type VozDaConta } from "@/features/servidor/vozes-tipos";

import type {
  AtorHistorico,
  Configuracao,
  Conexao,
  Contato,
  Convite,
  Conversa,
  ChaveIA,
  CustoIA,
  EstadoBase,
  Etapa,
  EventoPassagem,
  HistoricoEtapa,
  Membro,
  Mensagem,
  MotivoHumano,
  OrigemPassagem,
  StatusMensagem,
  TipoMensagem,
} from "./tipos";

// Os dados fictícios do modo exemplo: um arquivo só, coerente entre as telas (o mesmo lead aparece
// no Chat, no Kanban e em Contatos). Os leads e as conversas são os dos protótipos que o equipe já viu:
// os 8 do Chat final (as conversas ricas) e 15 do Kanban 2. Telefones (xx) 90000-xxxx, e-mails em
// ".exemplo" e empresas inventadas: nada de pessoa ou empresa real. Nenhum número daqui vale como
// número de negócio (spec, premissas).
//
// As horas são as dos protótipos, relativas ao "agora" deles (hoje, 14:44): cada momento vira
// "tantos minutos antes de agora", então a ordem e as distâncias se mantêm em qualquer hora do dia.
// O dia que a tela mostra (hoje, ontem) sai do instante, no fuso de São Paulo, pela tela.

/** Os ids fixos que as telas e os testes podem usar. */
export const IDS = {
  voce: "mb-voce",
  marina: "mb-marina",
  /** O convite pendente do exemplo (spec da Equipe, F3). */
  convite: "cn-rodrigo",
  conexao: "cx-zapi",
  chaveResposta: "ch-resposta",
  etapa: {
    novo: "et-novo",
    em_qualificacao: "et-em-qualificacao",
    qualificado: "et-qualificado",
    em_negociacao: "et-em-negociacao",
    ganho: "et-ganho",
    perdido: "et-perdido",
  },
} as const;

type ChaveEtapa = keyof typeof IDS.etapa;
type Quem = "voce" | "marina";

/** Id do contato e da conversa de um lead do exemplo ("ricardo" → "ct-ricardo" / "cv-ricardo"). */
export const idContato = (lead: string) => `ct-${lead}`;
export const idConversa = (lead: string) => `cv-${lead}`;

/**
 * As vozes da "conta da ElevenLabs" do exemplo (spec-voz-uso, P18): três, sem prévia, porque a demo
 * não toca áudio inventado (o mesmo critério do QR code, que a demo também não inventa).
 */
export const VOZES_EXEMPLO: readonly VozDaConta[] = [
  { id: "exemplo-voz-a", nome: "Voz de exemplo A", detalhe: null, portugues: true, previa: null },
  { id: "exemplo-voz-b", nome: "Voz de exemplo B", detalhe: null, portugues: true, previa: null },
  { id: "exemplo-voz-c", nome: "Voz de exemplo C", detalhe: null, portugues: true, previa: null },
];

/* ---------- tempo ---------- */

/** [dia, hora]: dia 0 = hoje, -1 = ontem; hora "hh:mm" do protótipo. */
type Quando = readonly [dia: number, hora: string];

// O "agora" dos protótipos é 14:44; um minuto a mais deixa tudo no passado, até o que chegou às 14:44.
const REF_MIN = 14 * 60 + 45;

function minutosAntes([dia, hora]: Quando): number {
  const [h = 0, m = 0] = hora.split(":").map(Number);
  return -dia * 1440 + REF_MIN - (h * 60 + m);
}

/* ---------- as sementes ---------- */

interface MsgSemente {
  de: "lead" | "janete" | "tela" | "cel";
  em: Quando;
  texto?: string;
  tipo?: TipoMensagem;
  autor?: Quem;
  st?: StatusMensagem;
  midia?: { nome: string; mime: string; tamanho?: number };
  dur?: number;
  /** Só em áudio: o texto transcrito; `null` = sem transcrição. */
  transc?: string | null;
  reacao?: string;
  /** Índice (na lista de itens) da mensagem citada. */
  cita?: number;
  editada?: boolean;
  apagada?: boolean;
  erro?: string;
}

interface EventoSemente {
  ev: EventoPassagem["tipo"];
  em: Quando;
  quem?: Quem;
  motivo?: MotivoHumano;
  de?: OrigemPassagem;
  deQuem?: Quem;
}

type ItemSemente = MsgSemente | EventoSemente;

interface LeadSemente {
  lead: string;
  nome: string;
  zap: string;
  /** Só dígitos, com o código do país, como no banco (check telefone ~ '^[0-9]+$'). */
  tel: string;
  email?: string;
  empresa: string;
  /** A etapa atual é a última do histórico. */
  hist: readonly (readonly [ChaveEtapa, "sistema" | "janete" | Quem, Quando])[];
  modo: "janete" | "humano";
  resp?: Quem;
  motivo?: MotivoHumano;
  naoLidas?: number;
  devolvida?: Quando;
  resumo: string;
  obs?: string;
  /** Gasto de IA de cada resposta da Janete (US$, fictício). */
  custoResposta: number;
  digitando?: boolean;
  itens: readonly ItemSemente[];
}

const KB = 1024;
const MB = 1024 * 1024;
const JPG = "image/jpeg";
const PDF = "application/pdf";

const LEADS: readonly LeadSemente[] = [
  /* ===== Chat final: as 8 conversas ===== */
  {
    lead: "ricardo",
    nome: "Ricardo Menezes",
    zap: "Ricardo M.",
    tel: "5511900000001",
    empresa: "Mercado Bom Preço",
    hist: [
      ["novo", "sistema", [-1, "18:02"]],
      ["em_qualificacao", "janete", [-1, "18:03"]],
      ["qualificado", "janete", [-1, "18:11"]],
    ],
    modo: "humano",
    motivo: "janete_passou",
    naoLidas: 1,
    resumo:
      "Dono do Mercado Bom Preço, em Campinas. Quer trocar a fachada de pastilha por ACM num prédio de três andares e começar ainda neste semestre. Já recebeu o material de obras comerciais. Hoje perguntou se dá para começar no dia 10 fechando até sexta, e se há desconto à vista.",
    custoResposta: 0.018,
    itens: [
      { de: "lead", em: [-1, "18:02"], texto: "Boa tarde. Vi o anúncio de vocês. Vocês fazem reforma de fachada de loja?" },
      { de: "janete", em: [-1, "18:02"], texto: "Boa tarde, Ricardo. Fazemos, sim. Para eu entender melhor: é um prédio só? E em que cidade fica?" },
      {
        de: "lead",
        em: [-1, "18:05"],
        tipo: "audio",
        dur: 42,
        midia: { nome: "audio-ricardo.ogg", mime: "audio/ogg", tamanho: 68 * KB },
        transc:
          "É um prédio só, de três andares, aqui em Campinas. A fachada é de pastilha e está soltando em vários pontos. Queria trocar tudo por ACM e começar ainda neste semestre, se der.",
      },
      { de: "janete", em: [-1, "18:06"], texto: "Entendi: troca de pastilha por ACM num prédio de três andares, em Campinas. Consegue me mandar uma foto da fachada?" },
      { de: "lead", em: [-1, "18:09"], tipo: "imagem", midia: { nome: "fachada-frente.jpg", mime: JPG, tamanho: 1.6 * MB } },
      { de: "lead", em: [-1, "18:09"], texto: "Essa é a frente. A lateral é igual, só que menor.", editada: true },
      { de: "janete", em: [-1, "18:12"], texto: "Obrigada. Vou te mandar o nosso material de obras comerciais para você ir olhando.", reacao: "👍" },
      { de: "janete", em: [-1, "18:12"], tipo: "documento", midia: { nome: "obras-comerciais.pdf", mime: PDF, tamanho: 2.4 * MB } },
      { de: "lead", em: [0, "14:20"], texto: "Oi, boa tarde. Olhei o material. Se eu fechar até sexta, vocês conseguem começar no dia 10?" },
      { de: "lead", em: [0, "14:21"], apagada: true },
      {
        de: "janete",
        em: [0, "14:31"],
        st: "falhou",
        cita: 8,
        erro: "O WhatsApp não confirmou o envio.",
        texto: "A data de início quem confirma é a nossa equipe de obras. Já chamei uma pessoa para falar com você.",
      },
      { ev: "passou", em: [0, "14:32"], motivo: "janete_passou" },
      { de: "lead", em: [0, "14:40"], texto: "E à vista vocês fazem algum desconto?" },
    ],
  },
  {
    lead: "juliana",
    nome: "Juliana Prado",
    zap: "Ju Prado",
    tel: "5511900000002",
    email: "juliana@valeverde.exemplo",
    empresa: "Clínica Vale Verde",
    hist: [
      ["novo", "sistema", [0, "14:28"]],
      ["em_qualificacao", "janete", [0, "14:28"]],
    ],
    modo: "humano",
    motivo: "sem_credito",
    naoLidas: 2,
    resumo:
      "Clínica com duas salas. Hoje controla a agenda numa planilha e diz que está ficando difícil. Quer saber o valor do plano e pediu uma demonstração.",
    custoResposta: 0.009,
    itens: [
      { de: "lead", em: [0, "14:28"], texto: "Olá. Queria saber o valor do plano para clínica com duas salas." },
      { de: "janete", em: [0, "14:28"], texto: "Olá, Juliana. Posso te ajudar com isso. Hoje vocês controlam a agenda num sistema ou numa planilha?" },
      { de: "lead", em: [0, "14:38"], texto: "Numa planilha, e está ficando difícil." },
      { ev: "passou", em: [0, "14:40"], motivo: "sem_credito" },
      { de: "lead", em: [0, "14:41"], texto: "Vocês fazem uma demonstração?" },
    ],
  },
  {
    lead: "fernando",
    nome: "Fernando Castro",
    zap: "Fernando",
    tel: "5511900000003",
    empresa: "Auto Peças Rota 9",
    hist: [
      ["novo", "sistema", [0, "14:35"]],
      ["em_qualificacao", "janete", [0, "14:36"]],
    ],
    modo: "janete",
    resumo: "Loja de autopeças. Quer comprar pastilha de freio no atacado, perto de 200 peças por mês.",
    custoResposta: 0.007,
    digitando: true,
    itens: [
      { de: "lead", em: [0, "14:35"], texto: "Vocês vendem pastilha de freio no atacado?" },
      { de: "janete", em: [0, "14:35"], texto: "Vendemos, sim, Fernando. Para quantas peças por mês, mais ou menos?" },
      { de: "lead", em: [0, "14:42"], texto: "Depende do mês. Umas 200." },
    ],
  },
  {
    lead: "patricia",
    nome: "Patrícia Nogueira",
    zap: "Paty Nogueira",
    tel: "5511900000004",
    email: "patricia@equilibrio.exemplo",
    empresa: "Studio Pilates Equilíbrio",
    hist: [
      ["novo", "sistema", [-1, "16:10"]],
      ["qualificado", "janete", [-1, "16:15"]],
      ["em_negociacao", "marina", [-1, "16:33"]],
    ],
    modo: "humano",
    resp: "marina",
    motivo: "humano_tela",
    resumo:
      "Dona de um estúdio de pilates com uns 120 alunos por semana, em três turnos. Recebeu a proposta da Marina e vai decidir com a sócia.",
    obs: "Prefere falar depois das 10h.",
    custoResposta: 0.02,
    itens: [
      { de: "lead", em: [-1, "16:10"], texto: "Oi, tudo bem? Queria saber dos pacotes para o meu estúdio." },
      { de: "janete", em: [-1, "16:10"], texto: "Oi, Patrícia. Tudo ótimo. Quantos alunos vocês atendem por semana?" },
      {
        de: "lead",
        em: [-1, "16:14"],
        tipo: "audio",
        dur: 18,
        midia: { nome: "audio-patricia.ogg", mime: "audio/ogg", tamanho: 29 * KB },
        transc: "Uns cento e vinte, divididos em três turnos.",
      },
      { ev: "assumiu", em: [-1, "16:30"], quem: "marina", de: "janete" },
      { de: "tela", autor: "marina", em: [-1, "16:32"], texto: "Patrícia, aqui é a Marina. Montei uma proposta para 120 alunos, segue em anexo." },
      {
        de: "tela",
        autor: "marina",
        em: [-1, "16:32"],
        tipo: "documento",
        midia: { nome: "proposta-studio-equilibrio.pdf", mime: PDF, tamanho: 380 * KB },
      },
      { de: "lead", em: [0, "09:15"], texto: "Vou ver com a minha sócia e te falo até amanhã.", reacao: "🙏" },
    ],
  },
  {
    lead: "carlos",
    nome: "Carlos Eduardo Lima",
    zap: "Cadu",
    tel: "5511900000005",
    email: "carlos@trigofino.exemplo",
    empresa: "Padaria Trigo Fino",
    hist: [
      ["novo", "sistema", [-3, "10:47"]],
      ["qualificado", "janete", [-3, "10:58"]],
      ["em_negociacao", "voce", [-3, "11:20"]],
    ],
    modo: "humano",
    motivo: "humano_celular",
    resumo: "Padaria com duas lojas. Recebeu o orçamento na segunda e quer saber a validade. Sensível a frete.",
    custoResposta: 0.021,
    itens: [
      { de: "lead", em: [0, "08:50"], texto: "Bom dia. O orçamento que vocês mandaram vale até quando?" },
      { de: "janete", em: [0, "08:50"], texto: "Bom dia, Carlos. Vou confirmar com a equipe e já te digo." },
      { ev: "celular", em: [0, "09:02"] },
      { de: "cel", em: [0, "09:02"], texto: "Oi, Carlos. Vale até o fim do mês. Se fechar até sexta, mantenho o frete grátis." },
      { de: "lead", em: [0, "09:06"], texto: "Fechado. Me manda o contrato que eu assino hoje." },
    ],
  },
  {
    lead: "beatriz",
    nome: "Beatriz Santana",
    zap: "Bia",
    tel: "5511900000006",
    email: "beatriz@pontofocal.exemplo",
    empresa: "Ótica Ponto Focal",
    hist: [
      ["novo", "sistema", [-7, "15:04"]],
      ["qualificado", "janete", [-7, "15:20"]],
      ["em_negociacao", "voce", [-5, "17:40"]],
      ["ganho", "voce", [-1, "10:21"]],
    ],
    modo: "janete",
    devolvida: [-1, "10:22"],
    resumo: "Fechou contrato ontem. O treinamento da equipe da ótica está marcado para segunda às 9h.",
    obs: "Treinamento da equipe marcado para segunda, às 9h.",
    custoResposta: 0.016,
    itens: [
      { ev: "assumiu", em: [-1, "10:02"], quem: "voce", de: "janete" },
      { de: "tela", autor: "voce", em: [-1, "10:05"], texto: "Beatriz, contrato assinado. Obrigado pela confiança." },
      { de: "lead", em: [-1, "10:20"], texto: "Eu que agradeço. Começamos na segunda.", reacao: "❤️" },
      { ev: "devolveu", em: [-1, "10:22"], quem: "voce" },
      { de: "janete", em: [0, "09:00"], texto: "Oi, Beatriz. Passando para lembrar do treinamento de segunda às 9h. Precisa de algo antes?" },
      { de: "lead", em: [0, "09:30"], texto: "Tudo certo, obrigada." },
    ],
  },
  {
    lead: "marcos",
    nome: "Marcos Vieira",
    zap: "Marcos V.",
    tel: "5511900000007",
    empresa: "Escola de Idiomas Ponte",
    hist: [
      ["novo", "sistema", [-5, "09:12"]],
      ["qualificado", "janete", [-5, "09:30"]],
      ["perdido", "janete", [-3, "11:41"]],
    ],
    modo: "janete",
    resumo: "Escola de idiomas pequena. Achou o valor alto para o momento e disse que volta a pensar no ano que vem.",
    custoResposta: 0.012,
    itens: [
      { de: "lead", em: [-3, "11:40"], texto: "Achei caro para o momento. Vou deixar para o ano que vem." },
      { de: "janete", em: [-3, "11:41"], st: "entregue", texto: "Entendo, Marcos. Se mudar de ideia, é só me chamar por aqui." },
      {
        de: "janete",
        em: [-1, "11:45"],
        st: "cancelada",
        texto: "Oi, Marcos. Abrimos uma condição nova para escolas pequenas. Quer que eu te conte?",
      },
    ],
  },
  {
    lead: "aline",
    nome: "Aline Ribeiro",
    zap: "Aline",
    tel: "5511900000008",
    empresa: "Pet Shop Quatro Patas",
    hist: [["novo", "sistema", [0, "14:43"]]],
    modo: "janete",
    naoLidas: 3,
    resumo: "Pet shop pequeno com banho e tosa. Mandou um vídeo da loja e disse que faz umas 60 tosas por semana.",
    custoResposta: 0.004,
    itens: [
      { de: "lead", em: [0, "14:43"], texto: "Oi, vocês atendem pet shop pequeno?" },
      {
        de: "janete",
        em: [0, "14:43"],
        st: "entregue",
        texto: "Atendemos, sim, Aline. Me conta um pouco da loja: quantos banhos e tosas vocês fazem por semana?",
      },
      { de: "lead", em: [0, "14:44"], tipo: "video", dur: 18, midia: { nome: "tour-da-loja.mp4", mime: "video/mp4", tamanho: 4.8 * MB } },
      { de: "lead", em: [0, "14:44"], tipo: "figurinha", midia: { nome: "figurinha.webp", mime: "image/webp", tamanho: 22 * KB } },
      {
        de: "lead",
        em: [0, "14:44"],
        tipo: "audio",
        dur: 9,
        midia: { nome: "audio-aline.ogg", mime: "audio/ogg", tamanho: 15 * KB },
        transc: "É mais ou menos isso aí, umas 60 por semana.",
      },
    ],
  },

  /* ===== Kanban 2: os outros leads do quadro ===== */
  {
    lead: "carla",
    nome: "Carla Mendes",
    zap: "Carla Pão de Mel",
    tel: "5519900000101",
    email: "carla@paodemel.exemplo",
    empresa: "Padaria Pão de Mel",
    hist: [
      ["novo", "sistema", [0, "13:58"]],
      ["em_qualificacao", "janete", [0, "14:05"]],
    ],
    modo: "janete",
    naoLidas: 2,
    resumo:
      "Dona de padaria em Campinas, com imóvel próprio. Quer baixar a conta de luz por causa dos fornos e das geladeiras. Decide junto com o marido e perguntou se dá para parcelar.",
    custoResposta: 0.006,
    itens: [
      { de: "lead", em: [0, "13:58"], texto: "Oi, vi o anúncio de vocês no Instagram. Vocês instalam em padaria?" },
      {
        de: "janete",
        em: [0, "13:58"],
        texto:
          "Oi, Carla! Aqui é a Janete, da Empresa Exemplo. Instalamos sim. Padaria é um dos casos em que mais compensa, por causa dos fornos e das geladeiras.",
      },
      { de: "janete", em: [0, "13:59"], texto: "Para eu te dar uma ideia de economia: o imóvel é próprio ou alugado?" },
      { de: "lead", em: [0, "14:04"], texto: "Próprio. Fica em Campinas" },
      { de: "janete", em: [0, "14:05"], texto: "Ótimo! Quanto vem a conta de luz, mais ou menos? Pode mandar áudio, se for mais fácil." },
      {
        de: "lead",
        em: [0, "14:29"],
        tipo: "audio",
        dur: 21,
        midia: { nome: "audio-carla.ogg", mime: "audio/ogg", tamanho: 34 * KB },
        transc:
          "Então, a nossa conta tá vindo uns mil e trezentos, mil e quatrocentos por mês. Meu marido quer saber também se dá pra parcelar.",
      },
      {
        de: "janete",
        em: [0, "14:30"],
        st: "entregue",
        texto: "Obrigada pelo áudio, Carla. Com uma conta nessa faixa a economia costuma ser grande, e dá para parcelar sim.",
      },
      {
        de: "lead",
        em: [0, "14:31"],
        tipo: "imagem",
        texto: "Mandei a última conta",
        midia: { nome: "conta-de-luz-outubro.jpg", mime: JPG, tamanho: 1.1 * MB },
      },
    ],
  },
  {
    lead: "rafael",
    nome: "Rafael Albuquerque",
    zap: "Rafa Motos",
    tel: "5511900000102",
    email: "rafael@albuquerquemotos.exemplo",
    empresa: "Oficina Albuquerque Motos",
    hist: [
      ["novo", "sistema", [-1, "16:58"]],
      ["em_qualificacao", "janete", [-1, "17:05"]],
      ["qualificado", "janete", [-1, "17:39"]],
    ],
    modo: "humano",
    motivo: "janete_passou",
    naoLidas: 2,
    resumo:
      "Oficina de motos com conta de luz de R$ 980. Gostou da simulação e quer fechar ainda esta semana, se tiver desconto à vista.",
    custoResposta: 0.011,
    itens: [
      { de: "janete", em: [-1, "17:40"], texto: "Rafael, mandei a simulação com a sua conta de R$ 980. O que achou?" },
      { de: "lead", em: [-1, "17:52"], texto: "Vou olhar com calma e te falo" },
      { de: "lead", em: [0, "14:16"], texto: "Boa tarde. Olhei a simulação, gostei" },
      { de: "janete", em: [0, "14:17"], texto: "Que bom, Rafael! Ficou alguma dúvida?" },
      { de: "lead", em: [0, "14:19"], texto: "Se eu pagar à vista vocês dão quanto de desconto?" },
      {
        de: "janete",
        em: [0, "14:20"],
        texto: "Boa pergunta. Condição à vista quem define é a nossa equipe. Já chamei uma pessoa para falar com você, tá bom?",
      },
      { ev: "passou", em: [0, "14:20"], motivo: "janete_passou" },
      { de: "lead", em: [0, "14:21"], texto: "Fico no aguardo" },
      { de: "lead", em: [0, "14:23"], texto: "Consigo fechar ainda essa semana" },
    ],
  },
  {
    lead: "thiago",
    nome: "Thiago Nunes",
    zap: "Thiago Nunes",
    tel: "5511900000103",
    email: "thiago@nunesmateriais.exemplo",
    empresa: "Nunes Materiais de Construção",
    hist: [["novo", "sistema", [0, "13:51"]]],
    modo: "humano",
    motivo: "sem_credito",
    naoLidas: 2,
    resumo:
      "Loja de materiais de construção com um galpão de 600 m² e telhado de zinco. Mandou um áudio que a Janete não conseguiu ouvir.",
    custoResposta: 0.005,
    itens: [
      { de: "lead", em: [0, "13:51"], texto: "Bom dia, quero orçamento para o galpão" },
      { de: "janete", em: [0, "13:52"], texto: "Oi, Thiago! Aqui é a Janete, da Empresa Exemplo. Qual o tamanho aproximado do galpão?" },
      { de: "lead", em: [0, "14:04"], texto: "Uns 600 m², telhado de zinco" },
      {
        de: "lead",
        em: [0, "14:06"],
        tipo: "audio",
        dur: 34,
        midia: { nome: "audio-thiago.ogg", mime: "audio/ogg", tamanho: 55 * KB },
        transc: null,
      },
      { ev: "passou", em: [0, "14:06"], motivo: "sem_credito" },
    ],
  },
  {
    lead: "paulo",
    nome: "Paulo Henrique Viana",
    zap: "Paulo H. Viana",
    tel: "5511900000106",
    email: "paulo@vianacontabil.exemplo",
    empresa: "Viana Contabilidade",
    hist: [
      ["novo", "sistema", [-2, "14:12"]],
      ["em_qualificacao", "janete", [-2, "14:13"]],
    ],
    modo: "janete",
    resumo: "Escritório de contabilidade. Perguntou o preço e não mandou a conta de luz. A Janete já tentou retomar uma vez.",
    custoResposta: 0.006,
    itens: [
      { de: "lead", em: [-2, "14:12"], texto: "Boa tarde, quanto custa mais ou menos?" },
      {
        de: "janete",
        em: [-2, "14:12"],
        texto: "Boa tarde, Paulo! Depende do tamanho do sistema. Me manda uma foto da conta de luz que eu te passo uma estimativa?",
      },
      {
        de: "janete",
        em: [-1, "10:00"],
        st: "entregue",
        texto: "Oi, Paulo! Conseguiu achar a conta de luz? Com ela eu te mando a estimativa em poucos minutos.",
      },
    ],
  },
  {
    lead: "fernanda",
    nome: "Fernanda Rocha",
    zap: "Fê Rocha Doces",
    tel: "5511900000107",
    email: "fernanda@rochadoces.exemplo",
    empresa: "Rocha Doces Finos",
    hist: [
      ["novo", "sistema", [-9, "08:40"]],
      ["em_qualificacao", "janete", [-9, "08:46"]],
      ["qualificado", "janete", [-8, "11:02"]],
      ["em_negociacao", "marina", [-7, "09:15"]],
      ["ganho", "marina", [-1, "11:31"]],
    ],
    modo: "humano",
    resp: "marina",
    motivo: "humano_tela",
    resumo: "Confeitaria com dois fornos elétricos. Assinou o contrato ontem.",
    custoResposta: 0.014,
    itens: [
      { de: "lead", em: [-1, "10:02"], texto: "Pode mandar o contrato que eu assino hoje" },
      {
        de: "tela",
        autor: "marina",
        em: [-1, "10:15"],
        tipo: "documento",
        midia: { nome: "contrato-rocha-doces.pdf", mime: PDF, tamanho: 860 * KB },
      },
      { de: "lead", em: [-1, "11:30"], texto: "Assinado!" },
    ],
  },
  {
    lead: "marcelo",
    nome: "Marcelo Dias",
    zap: "Marcelo Dias Transp.",
    tel: "5511900000108",
    email: "marcelo@diastransportes.exemplo",
    empresa: "Dias Transportes",
    hist: [
      ["novo", "sistema", [-6, "15:00"]],
      ["em_qualificacao", "janete", [-6, "15:04"]],
      ["perdido", "janete", [0, "11:15"]],
    ],
    modo: "janete",
    resumo: "Transportadora pequena. Achou o investimento alto agora e aceitou ser chamado em março para refazer a simulação.",
    custoResposta: 0.01,
    itens: [
      { de: "janete", em: [0, "10:50"], texto: "Marcelo, conseguiu ver a simulação?" },
      { de: "lead", em: [0, "11:12"], texto: "Vi sim. Achei caro, vou deixar para o ano que vem" },
      { de: "janete", em: [0, "11:13"], texto: "Entendo, Marcelo. Posso te chamar em março para refazer a simulação?" },
      { de: "lead", em: [0, "11:15"], texto: "Pode sim" },
    ],
  },
  {
    lead: "ana",
    nome: "Ana Clara Souza",
    zap: "Ana Clara Ateliê",
    tel: "5511900000110",
    email: "anaclara@atelieac.exemplo",
    empresa: "Ateliê Ana Clara",
    hist: [["novo", "sistema", [0, "14:27"]]],
    modo: "janete",
    naoLidas: 1,
    resumo: "Ateliê de costura nos fundos de casa. Quer saber o preço.",
    custoResposta: 0.004,
    itens: [
      { de: "lead", em: [0, "14:27"], texto: "Oi! Quanto custa para instalar placa solar?" },
      {
        de: "janete",
        em: [0, "14:28"],
        texto: "Oi, Ana Clara! Aqui é a Janete, da Empresa Exemplo. Para te passar um valor justo, preciso de duas informações rápidas.",
      },
      { de: "janete", em: [0, "14:28"], texto: "O ateliê fica na sua casa ou numa sala comercial?" },
      { de: "lead", em: [0, "14:31"], texto: "Na minha casa, nos fundos" },
    ],
  },
  {
    lead: "renata",
    nome: "Renata Okada",
    zap: "Renata Okada",
    tel: "5511900000113",
    email: "renata@okadahorti.exemplo",
    empresa: "Okada Hortifrúti",
    hist: [
      ["novo", "sistema", [0, "14:22"]],
      ["em_qualificacao", "janete", [0, "14:23"]],
    ],
    modo: "janete",
    resumo: "Hortifrúti com 4 câmaras frias e conta perto de R$ 3.000. Bom perfil para o solar.",
    custoResposta: 0.006,
    itens: [
      { de: "lead", em: [0, "14:22"], texto: "Temos 4 câmaras frias, a conta é bem alta" },
      { de: "janete", em: [0, "14:23"], texto: "Câmara fria é justamente onde o solar mais compensa, Renata. Quanto vem a conta, mais ou menos?" },
      { de: "lead", em: [0, "14:27"], texto: "Uns 3 mil" },
      { de: "janete", em: [0, "14:28"], st: "entregue", texto: "Com essa conta, o sistema se paga rápido. Você decide sozinha ou tem sócio?" },
    ],
  },
  {
    lead: "diego",
    nome: "Diego Martins",
    zap: "Diego Martins",
    tel: "5511900000114",
    email: "diego@martinsacademia.exemplo",
    empresa: "Martins Academia",
    hist: [
      ["novo", "sistema", [0, "09:40"]],
      ["em_qualificacao", "janete", [0, "09:47"]],
    ],
    modo: "janete",
    resumo: "Academia com esteiras e ar-condicionado ligados o dia todo. Ficou de olhar a conta de luz.",
    custoResposta: 0.007,
    itens: [
      { de: "lead", em: [0, "09:40"], texto: "Bom dia, vi o anúncio" },
      { de: "janete", em: [0, "09:41"], texto: "Bom dia, Diego! Aqui é a Janete, da Empresa Exemplo. Qual é o seu negócio?" },
      { de: "lead", em: [0, "09:46"], texto: "Academia. Umas 20 esteiras e o ar ligado o dia todo" },
      { de: "janete", em: [0, "09:47"], texto: "Com esse consumo vale muito a pena. Quanto vem a conta, mais ou menos?" },
      { de: "lead", em: [0, "13:16"], texto: "Vou ver aqui e te falo" },
      { de: "janete", em: [0, "13:17"], texto: "Fico no aguardo, Diego. Qualquer dúvida é só me chamar." },
    ],
  },
  {
    lead: "roberto",
    nome: "Roberto Sales",
    zap: "Roberto Mercadinho",
    tel: "5511900000115",
    email: "roberto@salesmercadinho.exemplo",
    empresa: "Sales Mercadinho",
    hist: [
      ["novo", "sistema", [-1, "09:00"]],
      ["em_qualificacao", "janete", [-1, "09:05"]],
    ],
    modo: "janete",
    resumo: "Mercadinho de bairro. Ficou de conversar com a esposa antes de seguir.",
    custoResposta: 0.005,
    itens: [
      { de: "lead", em: [-1, "09:10"], texto: "Vou ver com a minha esposa e te aviso" },
      { de: "janete", em: [-1, "09:11"], texto: "Combinado, Roberto! Fico no aguardo." },
      { de: "janete", em: [0, "09:30"], st: "entregue", texto: "Roberto, conseguiu conversar com a sua esposa?" },
    ],
  },
  {
    lead: "lucas",
    nome: "Lucas Teixeira",
    zap: "Lucas Pet",
    tel: "5511900000116",
    email: "lucas@teixeirapet.exemplo",
    empresa: "Teixeira Pet Shop",
    hist: [
      ["novo", "sistema", [-1, "17:30"]],
      ["em_qualificacao", "janete", [-1, "17:34"]],
      ["qualificado", "janete", [-1, "18:02"]],
    ],
    modo: "janete",
    resumo: "Pet shop com banho e tosa. Gostou da simulação e está perto de agendar a visita técnica.",
    custoResposta: 0.008,
    itens: [
      { de: "janete", em: [0, "14:20"], texto: "Lucas, mandei a simulação com as parcelas. O que achou?" },
      { de: "lead", em: [0, "14:25"], texto: "A simulação ficou boa" },
      { de: "janete", em: [0, "14:26"], st: "entregue", texto: "Que bom! Quer que eu já marque uma visita técnica?" },
    ],
  },
  {
    lead: "sergio",
    nome: "Sérgio Ramos",
    zap: "Sérgio Gráfica",
    tel: "5511900000118",
    email: "sergio@ramosgrafica.exemplo",
    empresa: "Ramos Gráfica",
    hist: [
      ["novo", "sistema", [-7, "14:00"]],
      ["em_qualificacao", "janete", [-7, "14:03"]],
      ["qualificado", "janete", [-5, "09:30"]],
      ["em_negociacao", "voce", [-2, "11:00"]],
    ],
    modo: "humano",
    resp: "voce",
    motivo: "humano_tela",
    resumo: "Gráfica com máquinas grandes. Pediu um inversor maior na proposta.",
    custoResposta: 0.013,
    itens: [
      { de: "tela", autor: "voce", em: [0, "12:20"], texto: "Sérgio, ajustei a proposta com o inversor maior que você pediu." },
      {
        de: "tela",
        autor: "voce",
        em: [0, "12:20"],
        tipo: "documento",
        midia: { nome: "proposta-ramos-grafica-v2.pdf", mime: PDF, tamanho: 1.4 * MB },
      },
      { de: "lead", em: [0, "12:22"], texto: "Vou analisar com calma e te retorno amanhã" },
    ],
  },
  {
    lead: "camila",
    nome: "Camila Duarte",
    zap: "Camila Buffet",
    tel: "5511900000119",
    email: "camila@duartebuffet.exemplo",
    empresa: "Duarte Buffet",
    hist: [
      ["novo", "sistema", [-8, "16:00"]],
      ["em_qualificacao", "janete", [-8, "16:02"]],
      ["qualificado", "janete", [-6, "10:40"]],
      ["em_negociacao", "marina", [-3, "10:00"]],
    ],
    modo: "janete",
    devolvida: [0, "11:50"],
    resumo: "Buffet com cozinha industrial. Recebeu a proposta e está comparando com outra empresa.",
    custoResposta: 0.012,
    itens: [
      { ev: "devolveu", em: [0, "11:50"], quem: "marina" },
      {
        de: "janete",
        em: [0, "11:52"],
        texto: "Oi, Camila! A Marina me pediu para acompanhar a sua proposta. Conseguiu dar uma olhada?",
      },
      { de: "lead", em: [0, "11:58"], texto: "Vi sim, estou comparando com outra empresa" },
      { de: "janete", em: [0, "11:59"], texto: "Faz sentido comparar. Se quiser, te mostro a diferença de garantia entre as duas." },
    ],
  },
  {
    lead: "vinicius",
    nome: "Vinícius Castro",
    zap: "Vini Barbearia",
    tel: "5511900000120",
    email: "vinicius@castrobarbearia.exemplo",
    empresa: "Castro Barbearia",
    hist: [
      ["novo", "sistema", [-10, "11:00"]],
      ["em_qualificacao", "janete", [-10, "11:02"]],
      ["qualificado", "janete", [-9, "15:10"]],
      ["em_negociacao", "voce", [-7, "10:00"]],
      ["ganho", "voce", [-3, "15:01"]],
    ],
    modo: "humano",
    resp: "voce",
    motivo: "humano_tela",
    resumo: "Barbearia com três cadeiras e ar-condicionado. Fechou e pediu para marcar a instalação.",
    custoResposta: 0.015,
    itens: [{ de: "lead", em: [-3, "15:00"], texto: "Fechado! Pode marcar a instalação" }],
  },
  {
    lead: "helena",
    nome: "Helena Barros",
    zap: "Helena Papelaria",
    tel: "5511900000121",
    email: "helena@barrospapelaria.exemplo",
    empresa: "Barros Papelaria",
    hist: [
      ["novo", "sistema", [-4, "09:00"]],
      ["em_qualificacao", "janete", [-4, "09:03"]],
      ["perdido", "marina", [-1, "10:30"]],
    ],
    modo: "humano",
    resp: "marina",
    motivo: "humano_tela",
    resumo: "Papelaria de bairro. Fechou com outra empresa.",
    custoResposta: 0.006,
    itens: [
      { de: "lead", em: [-1, "10:20"], texto: "Obrigada, mas já fechei com outra empresa" },
      { de: "tela", autor: "marina", em: [-1, "10:28"], texto: "Tudo bem, Helena! Se precisar, estamos por aqui." },
    ],
  },
];

/* ---------- o que a Janete anotou (extra de tela) ---------- */

/**
 * Um fato: [rótulo, valor, índice (na lista de itens do lead) da mensagem de onde saiu]. Índice
 * `null` = o fato só está no resumo. O valor fica em texto, do jeito que o lead falou.
 */
type FatoSemente = readonly [rotulo: string, valor: string, item: number | null];

interface AnotacaoSemente {
  fatos: readonly FatoSemente[];
  /** [título no infinitivo, a frase que explica com o que o lead disse]. */
  passo?: readonly [titulo: string, texto: string];
}

// Os fatos e o próximo passo de cada lead (spec de Contatos, decisões 6 e 7). Só o que já está no
// resumo e nas mensagens dele, nada novo. Lead fora daqui fica com o perfil quase vazio (Ana Clara,
// que acabou de chegar); quem está em Perdido não tem próximo passo.
const ANOTACOES: Readonly<Record<string, AnotacaoSemente>> = {
  ricardo: {
    fatos: [
      ["Interesse", "Trocar a fachada de pastilha por ACM", 2],
      ["Imóvel", "Prédio de três andares, em Campinas", 2],
      ["Prazo", "Começar no dia 10, se fechar até sexta", 8],
      ["Pagamento", "Perguntou se há desconto à vista", 12],
    ],
    passo: [
      "Responder sobre o início e o desconto",
      "Ele quer começar no dia 10 se fechar até sexta e perguntou se há desconto à vista. A resposta da Janete sobre a data não chegou a ele.",
    ],
  },
  juliana: {
    fatos: [
      ["Interesse", "Uma demonstração", 4],
      ["Tamanho", "Clínica com duas salas", 0],
      ["Hoje usa", "Agenda numa planilha, que está ficando difícil", 2],
    ],
    passo: ["Marcar a demonstração", "Ela pediu uma demonstração e quer saber o valor do plano para a clínica de duas salas."],
  },
  fernando: {
    fatos: [
      ["Interesse", "Pastilha de freio no atacado", 0],
      ["Ramo", "Loja de autopeças", null],
      ["Tamanho", "Umas 200 peças por mês, dependendo do mês", 2],
    ],
    passo: ["Mandar as condições de atacado", "Ele quer pastilha de freio no atacado, umas 200 peças por mês, dependendo do mês."],
  },
  patricia: {
    fatos: [
      ["Interesse", "Pacotes para o estúdio", 0],
      ["Ramo", "Estúdio de pilates", null],
      ["Tamanho", "Uns 120 alunos por semana, em três turnos", 2],
      ["Quem decide", "Ela e a sócia", 6],
      ["Prazo", "Disse que responde até amanhã", 6],
    ],
    passo: ["Retomar se ela não responder", "Ela vai ver a proposta com a sócia e disse que responde até amanhã."],
  },
  carlos: {
    fatos: [
      ["Ramo", "Padaria com duas lojas", null],
      ["Prazo", "O orçamento vale até o fim do mês", 3],
      ["Condição", "Frete grátis se fechar até sexta", 3],
      ["Objeção", "Sensível a frete", null],
    ],
    passo: ["Mandar o contrato", "Ele respondeu “Fechado” e pediu o contrato para assinar hoje."],
  },
  beatriz: {
    fatos: [
      ["Ramo", "Ótica", null],
      ["Contrato", "Assinado", 1],
      ["Prazo", "Treinamento da equipe na segunda, às 9h", 4],
    ],
    passo: [
      "Fazer o treinamento da equipe",
      "O treinamento da equipe da ótica está marcado para segunda às 9h, e ela respondeu que está tudo certo.",
    ],
  },
  marcos: {
    fatos: [
      ["Ramo", "Escola de idiomas pequena", null],
      ["Objeção", "Achou caro para o momento", 0],
      ["Prazo", "Vai deixar para o ano que vem", 0],
    ],
  },
  aline: { fatos: [["Tamanho", "Umas 60 tosas por semana", 4]] },
  carla: {
    fatos: [
      ["Ramo", "Padaria", 0],
      ["Imóvel", "Próprio, em Campinas", 3],
      ["Conta de luz", "Uns mil e trezentos, mil e quatrocentos por mês", 5],
      ["Quem decide", "Ela e o marido", 5],
      ["Pagamento", "Quer saber se dá para parcelar", 5],
    ],
    passo: ["Mandar a simulação com parcelas", "Ela mandou a última conta de luz, e o marido quer saber se dá para parcelar."],
  },
  rafael: {
    fatos: [
      ["Ramo", "Oficina de motos", null],
      ["Conta de luz", "R$ 980", 0],
      ["Interesse", "Gostou da simulação", 2],
      ["Pagamento", "Quer desconto à vista", 4],
      ["Prazo", "Consegue fechar ainda esta semana", 8],
    ],
    passo: [
      "Responder sobre o desconto à vista",
      "Ele gostou da simulação, perguntou quanto de desconto dão à vista e disse que consegue fechar ainda esta semana.",
    ],
  },
  thiago: {
    fatos: [
      ["Interesse", "Orçamento para o galpão", 0],
      ["Tamanho", "Uns 600 m², telhado de zinco", 2],
    ],
    passo: [
      "Ouvir o áudio do Thiago",
      "Ele mandou um áudio que a Janete não conseguiu ouvir. Pediu orçamento para um galpão de uns 600 m², com telhado de zinco.",
    ],
  },
  paulo: {
    fatos: [
      ["Ramo", "Escritório de contabilidade", null],
      ["Interesse", "Saber o preço", 0],
    ],
    passo: ["Pedir a conta de luz de novo", "Ele perguntou o preço e ainda não mandou a conta de luz. A Janete já tentou retomar uma vez."],
  },
  fernanda: {
    fatos: [
      ["Ramo", "Confeitaria com dois fornos elétricos", null],
      ["Contrato", "Assinado", 2],
    ],
  },
  marcelo: {
    fatos: [
      ["Ramo", "Transportadora pequena", null],
      ["Objeção", "Achou caro, vai deixar para o ano que vem", 1],
      ["Prazo", "Pode ser chamado em março para refazer a simulação", 2],
    ],
  },
  renata: {
    fatos: [
      ["Ramo", "Hortifrúti", null],
      ["Tamanho", "4 câmaras frias", 0],
      ["Conta de luz", "Uns 3 mil", 2],
    ],
    passo: ["Confirmar quem decide", "A Janete perguntou se ela decide sozinha ou tem sócio, e a resposta ainda não veio."],
  },
  diego: {
    fatos: [
      ["Ramo", "Academia", 2],
      ["Tamanho", "Umas 20 esteiras e o ar ligado o dia todo", 2],
      ["Conta de luz", "Ficou de ver quanto vem", 4],
    ],
    passo: ["Pedir o valor da conta de luz", "Ele ficou de ver quanto vem a conta e avisar."],
  },
  roberto: {
    fatos: [
      ["Ramo", "Mercadinho de bairro", null],
      ["Quem decide", "Ele e a esposa", 0],
    ],
    passo: ["Retomar depois da conversa com a esposa", "Ele ficou de ver com a esposa, e a Janete já perguntou hoje se eles conversaram."],
  },
  lucas: {
    fatos: [
      ["Ramo", "Pet shop com banho e tosa", null],
      ["Interesse", "Achou a simulação boa", 1],
    ],
    passo: ["Marcar a visita técnica", "Ele achou a simulação boa, e a Janete ofereceu marcar a visita técnica."],
  },
  sergio: {
    fatos: [
      ["Ramo", "Gráfica com máquinas grandes", null],
      ["Interesse", "Inversor maior na proposta", 0],
      ["Prazo", "Disse que retorna amanhã", 2],
    ],
    passo: ["Retomar a proposta amanhã", "Ele recebeu a proposta com o inversor maior e disse que vai analisar com calma e retornar amanhã."],
  },
  camila: {
    fatos: [
      ["Ramo", "Buffet com cozinha industrial", null],
      ["Objeção", "Está comparando com outra empresa", 2],
    ],
    passo: [
      "Mostrar a diferença de garantia",
      "Ela está comparando a proposta com a de outra empresa, e a Janete ofereceu mostrar a diferença de garantia.",
    ],
  },
  vinicius: {
    fatos: [
      ["Ramo", "Barbearia com três cadeiras e ar-condicionado", null],
      ["Contrato", "Fechado", 0],
    ],
    passo: ["Marcar a instalação", "Ele fechou e pediu para marcar a instalação."],
  },
  helena: {
    fatos: [
      ["Ramo", "Papelaria de bairro", null],
      ["Objeção", "Já fechou com outra empresa", 0],
    ],
  },
};

/** Os extras `fatosJanete` e `proximoPasso` de um lead, com o id real da mensagem de cada fato. */
function anotacoesDo(lead: string, idsItens: readonly string[]): Pick<Contato, "fatosJanete" | "proximoPasso"> {
  const a = ANOTACOES[lead];
  return {
    fatosJanete: (a?.fatos ?? []).map(([rotulo, valor, item]) => ({
      rotulo,
      valor,
      mensagemId: item === null ? null : (idsItens[item] ?? null),
    })),
    proximoPasso: a?.passo ? { titulo: a.passo[0], texto: a.passo[1] } : null,
  };
}

/* ---------- montagem ---------- */

// Pelo `ev`, e não pelo `de`: a passagem "assumiu" também tem `de` (de onde a conversa veio).
const ehMensagem = (i: ItemSemente): i is MsgSemente => !("ev" in i);

const ORIGEM = { lead: "lead", janete: "janete", tela: "humano_tela", cel: "humano_celular" } as const;

/** A prévia que o banco grava na conversa: o texto, ou "[tipo]" (gatilho tg_mensagens_apos_inserir). */
export function previaDoBanco(m: Pick<Mensagem, "texto" | "tipo">): string {
  const texto = m.texto?.trim();
  return (texto ? texto : `[${m.tipo}]`).slice(0, 140);
}

/**
 * O estado inicial do exemplo, com os momentos contados a partir de `agora`. Recarregar a página (ou
 * "Recomeçar o exemplo") monta de novo.
 */
export function criarEstadoInicial(agora: Date = new Date()): EstadoBase {
  const base = agora.getTime();
  // Itens no mesmo minuto ganham segundos crescentes, para a ordem da conversa não depender do sort.
  const usados = new Map<number, number>();
  const iso = (q: Quando) => {
    const min = minutosAntes(q);
    const n = usados.get(min) ?? 0;
    usados.set(min, n + 1);
    return new Date(base - min * 60_000 + n * 1000).toISOString();
  };
  const isoPuro = (q: Quando) => new Date(base - minutosAntes(q) * 60_000).toISOString();
  const membroDe = (q: Quem) => (q === "voce" ? IDS.voce : IDS.marina);

  const etapas: Etapa[] = (
    [
      ["novo", "Novo", 10, "aberta", false],
      ["em_qualificacao", "Em qualificação", 20, "aberta", true],
      ["qualificado", "Qualificado", 30, "aberta", true],
      ["em_negociacao", "Em negociação", 40, "aberta", false],
      ["ganho", "Ganho", 50, "ganho", false],
      ["perdido", "Perdido", 60, "perdido", true],
    ] as const
  ).map(([chave, nome, ordem, tipo, janete]) => ({
    id: IDS.etapa[chave],
    chave,
    nome,
    ordem,
    tipo,
    cor: null,
    janete_pode_mover: janete,
    arquivada: false,
  }));

  const criadoEmpresa = isoPuro([-30, "09:00"]);
  const membros: Membro[] = [
    // O admin aparece como "Você" quando é ele quem olha (nomeDoMembro); para a Marina, é "Admin".
    { id: IDS.voce, nome: "Admin", email: "admin@empresa.exemplo", papel: "admin", ativo: true, user_id: null, criado_em: criadoEmpresa },
    {
      id: IDS.marina,
      nome: "Marina",
      email: "marina@empresa.exemplo",
      papel: "atendente",
      ativo: true,
      user_id: null,
      criado_em: isoPuro([-20, "10:00"]),
    },
  ];

  const conexao: Conexao = {
    id: IDS.conexao,
    nome: "(11) 90000-0000",
    gateway: "zapi",
    status: "conectada",
    ativa: true,
    oficial: false,
    id_externo: "INSTANCIA-EXEMPLO",
    ultimo_erro: null,
    criado_em: criadoEmpresa,
    atualizado_em: criadoEmpresa,
  };

  // A chave de resposta está ativa: o crédito acabou à tarde (Juliana e Thiago esperam por isso) e
  // o admin recarregou e validou de novo logo depois. Sem chave de transcrição: sem escuta de áudio.
  const chaves: ChaveIA[] = [
    {
      id: IDS.chaveResposta,
      finalidade: "resposta",
      provedor: "anthropic",
      modelo: "claude-haiku-5-5",
      status: "ativa",
      ultimos4: "TSTE",
      ultimo_erro: null,
      validada_em: isoPuro([0, "14:43"]),
      atualizada_em: isoPuro([0, "14:43"]),
      atualizada_por: IDS.voce,
    },
  ];

  const configuracao: Configuracao = {
    id: 1,
    espera_lote_s: 8,
    espera_lote_max_s: 60,
    onboarding_concluido_em: criadoEmpresa,
    atualizado_em: criadoEmpresa,
    // o exemplo começa sem chave de voz: o modo padrão e nenhuma voz escolhida (spec-voz-uso, C3)
    voz_resposta: MODO_VOZ_PADRAO,
    voz_id: null,
    voz_nome: null,
    voz_erro: null,
  };

  const contatos: Contato[] = [];
  const conversas: Conversa[] = [];
  const mensagens: Mensagem[] = [];
  const historico: HistoricoEtapa[] = [];
  const eventos: EventoPassagem[] = [];
  const custos: CustoIA[] = [];
  const digitando: string[] = [];

  for (const l of LEADS) {
    const ctId = idContato(l.lead);
    const cvId = idConversa(l.lead);

    // histórico de etapas (o 1º é a entrada em Novo, pelo sistema)
    let anterior: string | null = null;
    let etapaDesde = "";
    l.hist.forEach(([chave, ator, q], i) => {
      const para = IDS.etapa[chave];
      const em = isoPuro(q);
      const a: AtorHistorico = ator === "sistema" || ator === "janete" ? ator : "membro";
      historico.push({
        id: `hi-${l.lead}-${i + 1}`,
        contato_id: ctId,
        de_etapa_id: anterior,
        para_etapa_id: para,
        ator: a,
        membro_id: a === "membro" ? membroDe(ator as Quem) : null,
        criado_em: em,
      });
      anterior = para;
      etapaDesde = em;
    });
    const primeira = isoPuro(l.hist[0]![2]);

    // mensagens e passagens
    const idsItens: string[] = [];
    let nMsg = 0;
    let nEv = 0;
    let ultimaEm: string | null = null;
    let ultimaPrevia: string | null = null;
    let ultimaDoLead: string | null = null;
    let aguardandoDesde: string | null = null;
    l.itens.forEach((item) => {
      const em = iso(item.em);
      if (!ehMensagem(item)) {
        nEv += 1;
        const id = `ev-${l.lead}-${nEv}`;
        idsItens.push(id);
        eventos.push({
          id,
          conversa_id: cvId,
          tipo: item.ev,
          membro_id: item.quem ? membroDe(item.quem) : null,
          motivo: item.motivo ?? null,
          de: item.de ?? null,
          de_membro_id: item.deQuem ? membroDe(item.deQuem) : null,
          por_envio: false,
          criado_em: em,
        });
        if (item.ev === "passou") aguardandoDesde = em;
        return;
      }
      nMsg += 1;
      const id = `msg-${l.lead}-${nMsg}`;
      idsItens.push(id);
      const tipo = item.tipo ?? "texto";
      const entrada = item.de === "lead";
      const status: StatusMensagem = item.st ?? (entrada ? "recebida" : "lida");
      const m: Mensagem = {
        id,
        conversa_id: cvId,
        conexao_id: IDS.conexao,
        direcao: entrada ? "entrada" : "saida",
        origem: ORIGEM[item.de],
        tipo,
        status,
        texto: item.apagada ? null : (item.texto ?? null),
        transcricao: tipo === "audio" ? (item.transc ?? null) : null,
        momento: em,
        autor_membro_id: item.de === "tela" ? membroDe(item.autor ?? "voce") : null,
        midia_nome: item.midia?.nome ?? null,
        midia_mime: item.midia?.mime ?? null,
        midia_tamanho: item.midia?.tamanho !== undefined ? Math.round(item.midia.tamanho) : null,
        midia_caminho: null,
        midia_status: item.midia ? "copiada" : null,
        editada: item.editada ?? false,
        apagada_em: item.apagada ? em : null,
        erro: item.erro ?? null,
        criado_em: em,
        reacao: item.reacao ?? null,
        citaId: item.cita !== undefined ? (idsItens[item.cita] ?? null) : null,
        duracaoS: item.dur ?? null,
      };
      mensagens.push(m);
      if (status !== "cancelada") {
        ultimaEm = em;
        ultimaPrevia = previaDoBanco(m);
      }
      if (entrada) ultimaDoLead = em;
      if (item.de === "janete") {
        custos.push({
          id: custos.length + 1,
          conversa_id: cvId,
          criado_em: em,
          custo_usd: l.custoResposta,
          tipo: "resposta",
          provedor: "anthropic",
          modelo: "claude-haiku-5-5",
        });
      }
    });

    const esperando = l.modo === "humano" && !l.resp && l.motivo !== "humano_celular";
    contatos.push({
      id: ctId,
      nome: l.nome,
      nome_whatsapp: l.zap,
      telefone: l.tel,
      email: l.email ?? null,
      empresa: l.empresa,
      etapa_id: anterior ?? IDS.etapa.novo,
      etapa_desde: etapaDesde,
      observacoes: l.obs ?? null,
      resumo_janete: l.resumo,
      primeira_mensagem_em: primeira,
      criado_em: primeira,
      atualizado_em: ultimaEm ?? primeira,
      ...anotacoesDo(l.lead, idsItens),
    });
    conversas.push({
      id: cvId,
      contato_id: ctId,
      conexao_id: IDS.conexao,
      modo: l.modo,
      motivo_humano: l.modo === "humano" ? (l.motivo ?? "humano_tela") : null,
      responsavel_id: l.modo === "humano" && l.resp ? membroDe(l.resp) : null,
      aguardando_humano_desde: esperando ? (aguardandoDesde ?? ultimaEm) : null,
      devolvida_em: l.devolvida ? isoPuro(l.devolvida) : null,
      nao_lidas: l.naoLidas ?? 0,
      ultima_do_lead_em: ultimaDoLead,
      ultima_mensagem_em: ultimaEm,
      ultima_mensagem_preview: ultimaPrevia,
      criado_em: primeira,
      atualizado_em: ultimaEm ?? primeira,
    });
    if (l.digitando) digitando.push(cvId);
  }

  // O convite pendente do exemplo (spec da Equipe, F3): e-mail fictício, ainda sem senha.
  const convites: Convite[] = [
    { id: IDS.convite, email: "rodrigo@empresa.exemplo", papel: "atendente", convidado_por: IDS.voce, enviado_em: isoPuro([-1, "17:20"]) },
  ];

  return {
    etapas,
    membros,
    convites,
    contatos,
    conversas,
    mensagens,
    historico,
    conexao,
    chaves,
    configuracao,
    eventos,
    digitando,
    custos,
    auditoria: [],
  };
}
