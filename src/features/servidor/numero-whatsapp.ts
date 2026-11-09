// O número do WhatsApp que a pessoa informa no formulário da Z-API e da Evolution, e o que o
// WhatsApp informa depois da leitura do QR code (spec-qr-whatsapp, seção 8). Puro: usado no
// servidor e na tela.
//
// - normalizarNumero: só dígitos, com o código do país. Com "+": 8 a 15 dígitos. Sem "+": tira os
//   zeros da frente; 10 ou 11 dígitos ganham o 55; 12 ou 13 começando com 55 ficam; o resto é null.
//   No Brasil (começa com 55), o DDD tem 2 dígitos de 1 a 9, e o número tem 8 dígitos (começando de
//   2 a 9) ou 9 começando com 9.
// - mesmoNumero: iguais, ou os dois do Brasil com o mesmo DDD e os mesmos 8 últimos dígitos (o 9 a
//   mais do celular nem sempre aparece no que o WhatsApp informa).
// - formatarNumero: "+55 11 98765-4321" e "+55 11 8765-4321"; fora do Brasil, "+" e os dígitos.
// - numeroDoJid: "5511987654321@s.whatsapp.net" e "…:12@s.whatsapp.net" viram os dígitos; @lid,
//   grupo e o resto viram null.

/** Só os caracteres que alguém digita num telefone: dígitos, espaço, parênteses, ponto e hífen. */
const DIGITAVEL = /^[\d\s().-]+$/;

/** Número do Brasil, já com o 55: DDD de 2 dígitos (1 a 9) e 8 dígitos (2 a 9 no começo) ou 9 com o 9. */
const BRASIL = /^55[1-9]{2}(?:[2-9]\d{7}|9\d{8})$/;

function ehDoBrasil(digitos: string): boolean {
  return digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13);
}

/**
 * Os caracteres invisíveis que vêm junto quando se copia um número (as marcas de direção que o
 * WhatsApp no Android põe em volta dele, e o BOM): saem antes de tudo.
 */
const INVISIVEIS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** Os traços Unicode (hífen que não quebra, travessão, sinal de menos…) contam como hífen. */
const TRACOS = /[\u2010-\u2015\u2212]/g;

/** Só dígitos, com o código do país; null quando não é um número de WhatsApp. */
export function normalizarNumero(texto: string): string | null {
  if (typeof texto !== "string") return null;
  const t = texto.replace(INVISIVEIS, "").replace(TRACOS, "-").trim();
  if (!t) return null;
  const comMais = t.startsWith("+");
  const resto = comMais ? t.slice(1) : t;
  if (!DIGITAVEL.test(resto)) return null;
  let digitos = resto.replace(/\D/g, "");
  if (comMais) {
    if (digitos.length < 8 || digitos.length > 15) return null;
  } else {
    digitos = digitos.replace(/^0+/, "");
    if (digitos.length === 10 || digitos.length === 11) digitos = `55${digitos}`;
    else if (!((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")))
      return null;
  }
  // o 55 é só do Brasil: com ele, o número tem de ser um número brasileiro
  if (digitos.startsWith("55") && !BRASIL.test(digitos)) return null;
  return digitos;
}

/** Os dois números (só dígitos) são do mesmo WhatsApp. */
export function mesmoNumero(a: string, b: string): boolean {
  const x = (a ?? "").replace(/\D/g, "");
  const y = (b ?? "").replace(/\D/g, "");
  if (!x || !y) return false;
  if (x === y) return true;
  if (!ehDoBrasil(x) || !ehDoBrasil(y)) return false;
  return x.slice(2, 4) === y.slice(2, 4) && x.slice(-8) === y.slice(-8);
}

/** O número (só dígitos) para mostrar na tela. */
export function formatarNumero(digitos: string): string {
  const d = (digitos ?? "").replace(/\D/g, "");
  if (ehDoBrasil(d)) {
    const ddd = d.slice(2, 4);
    const numero = d.slice(4);
    const corte = numero.length - 4;
    return `+55 ${ddd} ${numero.slice(0, corte)}-${numero.slice(corte)}`;
  }
  return `+${d}`;
}

/** Os dígitos de um jid de pessoa (@s.whatsapp.net, com ou sem o ":aparelho"); o resto é null. */
export function numeroDoJid(jid: string): string | null {
  if (typeof jid !== "string") return null;
  const m = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/.exec(jid.trim());
  return m ? m[1]! : null;
}
