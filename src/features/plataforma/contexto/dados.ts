import { semAnexos } from "./regras";
import type { ChaveCampo, ItemLivre, VersaoContexto } from "./tipos";

// Os dados de exemplo do Contexto (os testes e o modo exemplo): as 6 versões da "Empresa Exemplo", com
// os textos copiados do protótipo (Contexto-6.dc.html, versoesIniciais). Os instantes são de 26 a
// 28/10/2026 no relógio de São Paulo (UTC-3, sem horário de verão). A v6 é a atual: 6 de 8 campos e
// 3 itens livres. Sem anexos: na v1 eles ficam escondidos (decisão 11a), como no banco. O id de cada
// versão é igual ao número (no banco podem diferir; a tela usa o id para agir e o número para mostrar).

const T = {
  empresa1: "Consultoria de vendas para pequenas e médias empresas. Montamos o processo comercial do zero.",
  empresa6:
    "A Empresa Exemplo é uma consultoria de vendas para pequenas e médias empresas. Montamos o processo comercial do zero: roteiro de atendimento, funil no CRM e treinamento da equipe, em programas de 3 meses.",
  cliente:
    "Donos de empresas de serviço com 5 a 50 funcionários, que já vendem, mas ainda dependem do dono para fechar cada venda.",
  preco1: "De R$ 4.900 a R$ 14.900 por mês, conforme o tamanho da equipe.",
  preco3:
    "Três planos: Essencial, Pro e Completo, de R$ 4.900 a R$ 14.900 por mês, com programa mínimo de 3 meses. O valor exato só sai depois do diagnóstico gratuito.",
  dif1: "Consultor dedicado e implantação dentro do CRM que a empresa já usa.",
  dif3: "Consultor dedicado do começo ao fim, implantação dentro do CRM que a empresa já usa e acompanhamento semanal dos números.",
  humano:
    "Quando o lead aceita marcar o diagnóstico gratuito ou pede uma proposta por escrito. Também quando pergunta sobre contrato ou desconto.",
  tom1: "Próximo e direto.",
  tom4: "Animado e informal, com gírias.",
  tom6: "Próximo e direto, como um consultor experiente. Sem gírias e sem pressão. Frases curtas e uma pergunta por vez.",
  horario4: "Todos os dias, das 8h às 22h.",
} as const;

const L1: ItemLivre = { pergunta: "Vocês emitem nota fiscal?", resposta: "Sim, para todas as vendas." };
const L2: ItemLivre = {
  pergunta: "Atendem empresas fora de São Paulo?",
  resposta: "Sim. O programa é todo online, com visitas presenciais opcionais.",
};
const L3: ItemLivre = { pergunta: "Tem período de teste?", resposta: "Não. O diagnóstico gratuito de 1 hora faz esse papel." };

type Campos = Record<ChaveCampo, string>;

/** Uma cópia funda: cada versão é imutável e não divide listas com outra. */
function copiar(v: VersaoContexto): VersaoContexto {
  return { ...v, campos: { ...v.campos }, itens: v.itens.map((i) => ({ ...i })), anexos: semAnexos() };
}

/** As 6 versões, da mais nova (a atual, v6) para a mais velha. Cada chamada devolve cópias novas. */
export function versoesDeExemplo(): VersaoContexto[] {
  const campos1: Campos = {
    empresa_oferta: T.empresa1,
    cliente_ideal: T.cliente,
    preco: T.preco1,
    diferenciais: T.dif1,
    tom_voz: T.tom1,
    quando_passar_humano: T.humano,
    objecoes: "",
    horario: "",
  };
  const v1: VersaoContexto = {
    id: 1,
    numero: 1,
    origem: "onboarding",
    quem: "Você",
    criadoEm: "2026-10-26T16:40:00-03:00",
    resumo: "Montada no onboarding, com 6 campos.",
    campos: campos1,
    itens: [],
    anexos: semAnexos(),
  };
  const v2: VersaoContexto = {
    ...copiar(v1),
    id: 2,
    numero: 2,
    origem: "edicao",
    criadoEm: "2026-10-26T17:05:00-03:00",
    resumo: "Pergunta livre nova: Vocês emitem nota fiscal?",
    itens: [{ ...L1 }],
  };
  const base3 = copiar(v2);
  const v3: VersaoContexto = {
    ...base3,
    id: 3,
    numero: 3,
    criadoEm: "2026-10-27T09:30:00-03:00",
    resumo: "Preço e Diferenciais.",
    campos: { ...base3.campos, preco: T.preco3, diferenciais: T.dif3 },
  };
  const base4 = copiar(v3);
  const v4: VersaoContexto = {
    ...base4,
    id: 4,
    numero: 4,
    criadoEm: "2026-10-27T15:12:00-03:00",
    resumo: "Tom de voz, Horário e 1 pergunta livre.",
    campos: { ...base4.campos, tom_voz: T.tom4, horario: T.horario4 },
    itens: [{ ...L1 }, { ...L2 }],
  };
  // a 5 é a 3 restaurada: os mesmos campos e itens
  const v5: VersaoContexto = {
    ...copiar(v3),
    id: 5,
    numero: 5,
    origem: "restauracao",
    restauradaDe: 3,
    criadoEm: "2026-10-28T10:02:00-03:00",
    resumo: "Restaurada da versão 3.",
  };
  const base6 = copiar(v5);
  delete base6.restauradaDe;
  const v6: VersaoContexto = {
    ...base6,
    id: 6,
    numero: 6,
    origem: "edicao",
    criadoEm: "2026-10-28T18:20:00-03:00",
    resumo: "Empresa e oferta, Tom de voz e 2 perguntas livres.",
    campos: { ...base6.campos, empresa_oferta: T.empresa6, tom_voz: T.tom6 },
    itens: [{ ...L1 }, { ...L2 }, { ...L3 }],
  };
  return [v6, v5, v4, v3, v2, v1];
}
