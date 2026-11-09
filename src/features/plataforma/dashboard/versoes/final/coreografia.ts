// A coreografia do palco do funil (docs/spec-dashboard.md, 7.3 e 7.4), vinda da versão B, com a
// mudança 5 da final (docs/spec-dashboard-final.md): na fase 3 cada coluna também anda na horizontal
// (`lado`) até o lugar do chip dela na faixa que reserva o centro para a Janete, e a Janete entra nesse
// centro (`janete`, escala e opacidade), tudo pelo mesmo `p` da rolagem.
//
// Pura: recebe o progresso da rolagem `p` (0 a 1) e devolve o progresso de cada camada já passado
// pela curva dela (nunca o `p` cru). O motor do palco chama a cada quadro e escreve o resultado como
// variáveis CSS no elemento [data-dash="palco"]; o CSS só interpola posições fixas com elas. Nada
// aqui toca o DOM nem o React.
//
// A ordem das camadas segue a régua da 7.4: primeiro o recipiente (o cartão cresce), depois a
// estrutura (as barras), depois o conteúdo (números e métricas) e por último os detalhes (as quedas
// e os textos), com sobreposição leve entre elas e uma onda da esquerda para a direita entre as
// colunas (um atraso pequeno de `p` por coluna).
//
// A virada para o índice (fase 3) é feita num tempo só, para nenhum quadro ficar vazio nem em diagonal:
// o conteúdo aberto sai (`sai`), o pé do cartão sobe até logo abaixo das barras (`esvazia`) e, na mesma
// janela, cada barra "deita" (`d`, o recorte desce pelo topo até sobrar a mini barra) enquanto a base
// dela sobe com a fileira e o cartão (`ind`). Como `d` e `ind` andam juntos, a barra encolhe PARA O ALTO
// (spec 7.3): o topo dela acompanha o número até a linha da mini barra, e o pé do cartão fica sempre
// 12 px abaixo do pé visível das barras. A onda entre as colunas é mínima e só mexe no recorte; nome,
// número e mini barra de todas as colunas ficam na mesma linha horizontal em qualquer `p`.

export type FaseB = "repouso" | "crescer" | "abrir" | "indice" | "detalhe" | "resultado";

/** As 5 etapas do funil mais a coluna "Perdidos" (o destino de quem sai). */
export const N_COLUNAS = 6;

/** cubic-bezier(x1, y1, x2, y2) como função de t em [0, 1] (Newton e bisseção, como os navegadores). */
export function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const curvaX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const curvaY = (t: number) => ((ay * t + by) * t + cy) * t;
  const derivadaX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const resolver = (x: number): number => {
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const erro = curvaX(t) - x;
      if (Math.abs(erro) < 1e-6) return t;
      const d = derivadaX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= erro / d;
    }
    let baixo = 0;
    let alto = 1;
    t = x;
    for (let i = 0; i < 40; i += 1) {
      const v = curvaX(t);
      if (Math.abs(v - x) < 1e-6) return t;
      if (x > v) baixo = t;
      else alto = t;
      t = (baixo + alto) / 2;
    }
    return t;
  };
  // as curvas usadas não passam do ponto: o limite só tira o ruído de ponto flutuante (1,0000000000000002)
  return (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : Math.min(1, Math.max(0, curvaY(resolver(x)))));
}

/** O recipiente na fase 3: sai devagar e chega devagar (--sb-ease-travessia). */
export const curvaRecipiente = bezier(0.65, 0, 0.35, 1);
/** O conteúdo e os detalhes: entrada suave e chegada longa (o cubic-bezier(0.22, 1, 0.36, 1) da spec). */
export const curvaConteudo = bezier(0.22, 1, 0.36, 1);
/** Opacidades e a fase 3 (o cartão virando a faixa): suave nas duas pontas, inclinação máxima de 1,5. */
export const curvaFade = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
/**
 * A altura do cartão na fase 1: começa perto da velocidade da rolagem e termina parada (f(0) = 0,
 * f(1) = 1, f'(1) = 0, sempre crescente).
 */
export const curvaSubida = (t: number) => {
  const s = Math.min(1, Math.max(0, t));
  return Math.min(1, 1.1 * s + 0.8 * s * s - 0.9 * s * s * s);
};

/** O trecho de `p` de uma camada, de 0 a 1. */
export function trecho(p: number, inicio: number, duracao: number): number {
  return Math.min(1, Math.max(0, (p - inicio) / duracao));
}

/**
 * A viagem do palco preso, em telas (a altura do trilho). Com 2 telas, a fase 3 (de 0,735 a 0,98 de `p`)
 * tem ~500 px de rolagem em 1440 × 900, e nenhum quadro move o cartão mais de ~3 px por px rolado.
 */
export const VIAGEM_TELAS = 2;

/**
 * As faixas de `p` de cada camada ([início, duração]; as fases da 7.3, com as camadas da 7.4). O ritmo
 * dá o maior trecho parado ao funil aberto (o quadro mais rico da página): cresce até 0,38, abre até
 * ~0,56, fica inteiro para ser lido até 0,735 e então vira a faixa num tempo só, até 0,98.
 */
export const FAIXAS = {
  /**
   * A pílula "Role para ver cada etapa" (ajuste 4 do equipe): visível desde a dobra e durante todo o funil
   * aberto (é aí que parece que a página acabou); some quando a faixa começa a se formar, junto com o
   * começo da saída do conteúdo aberto e antes de o pé do cartão subir.
   */
  dica: [0.72, 0.035],
  /** Fase 1: o cartão cresce desde o 1º pixel até 0,38 (o recipiente). */
  cresce: [0, 0.38],
  /**
   * O pé do cartão (a área das quedas e das métricas) abre junto com o conteúdo que entra nele, de cima
   * para baixo: o espaço que abre já nasce com texto, sem uma faixa branca vazia embaixo das barras.
   */
  pe: [0.37, 0.08],
  /** A onda das barras: a 1ª coluna anda junto com o recipiente; as outras começam um pouco depois e chegam juntas. */
  barras: [0, 0.38],
  ondaBarras: 0.012,
  /**
   * Os números passam de 28 para 44 px (crossfade com escala). A onda é quase nula: em qualquer quadro
   * parado a diferença de tamanho entre a 1ª e a última coluna fica em ~2 px (as etiquetas não dançam).
   */
  numeros: [0.12, 0.22],
  ondaNumeros: 0.004,
  /** A sombra de repouso sai enquanto a funda entra. */
  sombraRepouso: [0.05, 0.2],
  /**
   * Fase 2, na ordem da leitura (de cima para baixo): o título troca, as quedas se abrem logo embaixo
   * das barras e as métricas entram embaixo delas, linha por linha, em onda; tudo pronto perto de 0,56,
   * e o funil aberto fica parado para ser lido até 0,735.
   */
  titulo: [0.38, 0.07],
  quedas: [0.38, 0.08],
  ondaQuedas: 0.012,
  metricas: [0.42, 0.08],
  ondaMetricas: 0.012,
  /**
   * Fase 3: o conteúdo aberto sai primeiro (o cartão nunca encolhe por cima de um texto visível), e
   * depressa (~75 px de rolagem em 1440 × 900). Ajuste 1 do equipe: começa em 0,735 para o cartão já
   * estar do tamanho das barras quando a fileira começa a subir (0,8).
   */
  sai: [0.735, 0.035],
  /**
   * O pé do cartão sobe até logo abaixo das barras logo atrás do conteúdo que some (ajuste 1 do equipe: o
   * cartão encolhe junto com o conteúdo, nunca um cartão grande parado e vazio). Ele começa a subir
   * quando o conteúdo ainda esmaece e só passa pela última linha de métricas depois que ela sumiu; a
   * janela de 0,065 mantém o pé abaixo de ~3 px de movimento por px rolado (a régua da 7.4).
   */
  esvazia: [0.755, 0.065],
  /**
   * As barras deitam (o recorte desce pelo topo) na MESMA janela em que a fileira e o cartão sobem até a
   * faixa: a altura das barras e a do cartão caem juntas, e nenhum quadro mostra o cartão vazio.
   */
  deita: [0.8, 0.18],
  ondaDeita: 0.003,
  indice: [0.8, 0.18],
  /**
   * Da final: cada coluna anda na horizontal até o lugar do chip dela na faixa com a Janete no centro
   * (as 3 primeiras se juntam um pouco à esquerda, as 3 últimas abrem para a direita).
   */
  lado: [0.81, 0.12],
  /**
   * Da final: a Janete entra no centro da faixa, no vão que as colunas abrem. Ajuste 1 do equipe: ela entra
   * já com a cor dela (a opacidade fica cheia nos primeiros 8% da entrada, quando ela ainda é um ponto de
   * ~14 px; o resto é só escala) e chega ao tamanho final antes de a fileira terminar de subir.
   */
  janete: [0.82, 0.11],
  chips: [0.86, 0.08],
  sombraFaixa: [0.86, 0.1],
  /** O véu e a sombra funda saem com a fase 3. */
  veuDesce: [0.8, 0.17],
  sombraDesce: [0.8, 0.16],
  /**
   * O 1º capítulo sobe colado ao pé do cartão que encolhe (o motor o empurra para baixo do cartão) e
   * nasce por opacidade: o título dele aparece logo embaixo do funil, sem um vão cinza no meio. Ajuste 1
   * do equipe: ele começa a aparecer quando entra na tela (perto de 0,765, com o pé do cartão subindo),
   * está na metade com ~100 px dele à vista e inteiro em 0,815 (antes, em 0,85, ele ainda estava em 4% e
   * sobrava um vão cinza de ~300 px embaixo do cartão).
   */
  capitulo: [0.765, 0.05],
  /** A partir daqui a faixa real (o <nav>) assume o lugar do desenho, que já está idêntico a ela. */
  troca: 0.99,
} as const;

export interface Camadas {
  p: number;
  /** 1 = a dica "role" visível; 0 = sumiu. */
  dica: number;
  /** O recipiente crescendo (fase 1). */
  cresce: number;
  /** O pé do cartão abrindo para as quedas e as métricas (fim da fase 1). */
  pe: number;
  /** O véu atrás do cartão (sobe na fase 1, some na 3). */
  veu: number;
  sombraA: number;
  sombraB: number;
  sombraC: number;
  /** A troca do título "Funil do período" → "O funil, etapa por etapa". */
  titulo: number;
  /** O conteúdo aberto (métricas, quedas, conversões, título) saindo na fase 3. */
  sai: number;
  /** O pé do cartão subindo até logo abaixo das barras (começo da fase 3). */
  esvazia: number;
  /** O recipiente e a fileira subindo até a faixa do índice (fase 3, junto com as barras deitando). */
  ind: number;
  /** As colunas andando na horizontal até o lugar do chip na faixa com a Janete no centro. */
  lado: number;
  /** A Janete entrando no centro da faixa (escala e opacidade). */
  janete: number;
  /** Os fundos dos chips, as setas e o "Para onde foram os que saíram". */
  chip: number;
  /** O 1º capítulo aparecendo embaixo do cartão que encolhe. */
  capitulo: number;
  /** Por coluna: as barras crescendo (fase 1). */
  b: number[];
  /** Por coluna: o número de 28 para 44 px. */
  n: number[];
  /** Por coluna: as métricas entrando (fase 2). */
  m: number[];
  /** Por coluna: as quedas se abrindo (fase 2). */
  q: number[];
  /** Por coluna: a barra deitando (fase 3, com a mesma janela do `ind`). */
  d: number[];
}

export function camadas(pEntrada: number): Camadas {
  const p = Math.min(1, Math.max(0, pEntrada));
  const F = FAIXAS;
  const cresce = curvaSubida(trecho(p, F.cresce[0], F.cresce[1]));
  // a fase 3 usa a curva suave (inclinação máxima 1,5): o cartão fecha preso à rolagem, sem estalo
  const ind = curvaFade(trecho(p, F.indice[0], F.indice[1]));
  const sai = curvaFade(trecho(p, F.sai[0], F.sai[1]));
  const b: number[] = [];
  const n: number[] = [];
  const m: number[] = [];
  const q: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < N_COLUNAS; i += 1) {
    // A onda: a mesma curva para todas, com o começo atrasado e o fim comum, então cada coluna fica
    // sempre um pouco atrás da anterior (a onda nunca se inverte e nenhuma barra passa do ponto final).
    const atraso = i * F.ondaBarras;
    b.push(curvaSubida(trecho(p, F.barras[0] + atraso, F.barras[1] - atraso)));
    n.push(curvaConteudo(trecho(p, F.numeros[0] + i * F.ondaNumeros, F.numeros[1])));
    m.push(curvaFade(trecho(p, F.metricas[0] + i * F.ondaMetricas, F.metricas[1])));
    q.push(curvaConteudo(trecho(p, F.quedas[0] + i * F.ondaQuedas, F.quedas[1])));
    // as barras deitam com uma onda mínima e todas chegam juntas (o fim é comum)
    const inicioDeita = F.deita[0] + i * F.ondaDeita;
    d.push(curvaFade(trecho(p, inicioDeita, F.deita[0] + F.deita[1] - inicioDeita)));
  }
  // a 1ª barra anda exatamente com o recipiente (a base e a altura juntas: o topo dela nunca oscila)
  b[0] = cresce;
  const veuSobe = curvaFade(trecho(p, 0.06, 0.3));
  const veuDesce = curvaFade(trecho(p, F.veuDesce[0], F.veuDesce[1]));
  return {
    p,
    dica: 1 - curvaFade(trecho(p, F.dica[0], F.dica[1])),
    cresce,
    pe: curvaFade(trecho(p, F.pe[0], F.pe[1])),
    veu: veuSobe * (1 - veuDesce),
    sombraA: 1 - curvaFade(trecho(p, F.sombraRepouso[0], F.sombraRepouso[1])),
    sombraB: curvaFade(trecho(p, 0.1, 0.3)) * (1 - curvaFade(trecho(p, F.sombraDesce[0], F.sombraDesce[1]))),
    sombraC: curvaFade(trecho(p, F.sombraFaixa[0], F.sombraFaixa[1])),
    titulo: curvaConteudo(trecho(p, F.titulo[0], F.titulo[1])),
    sai,
    esvazia: curvaFade(trecho(p, F.esvazia[0], F.esvazia[1])),
    ind,
    lado: curvaFade(trecho(p, F.lado[0], F.lado[1])),
    janete: curvaFade(trecho(p, F.janete[0], F.janete[1])),
    chip: curvaFade(trecho(p, F.chips[0], F.chips[1])),
    capitulo: curvaFade(trecho(p, F.capitulo[0], F.capitulo[1])),
    b,
    n,
    m,
    q,
    d,
  };
}

/** A fase de `p` (o atributo data-dash-fase e o estado React; "resultado" vem de fora). */
export function faseDoP(p: number): Exclude<FaseB, "resultado"> {
  if (p <= 0.0005) return "repouso";
  if (p < FAIXAS.cresce[0] + FAIXAS.cresce[1]) return "crescer";
  if (p < 0.8) return "abrir";
  if (p < 1) return "indice";
  return "detalhe";
}

/* ---------- a geometria do palco (medida no redimensionamento) ---------- */

export interface MedidasPalco {
  /** A altura visível embaixo do topo da casca. */
  v: number;
  /** A largura do cartão (a do conteúdo). */
  w: number;
  admin: boolean;
}

export interface GeometriaPalco {
  /** A altura visível embaixo do topo da casca (a da vista presa). */
  v: number;
  /** Recheio lateral fixo do cartão: as colunas nunca andam na horizontal. */
  px: number;
  h0: number;
  h1: number;
  hs: number;
  t1: number;
  t2: number;
  bh0: number;
  bh1: number;
  base0: number;
  base1: number;
  hmax: number;
  /** A largura de cada coluna das etapas (a dos "Perdidos" é 82% dela). */
  sw: number;
  bw: number;
  /** O comprimento máximo da mini barra do chip. */
  mini: number;
  /** Da final: a largura de cada chip da faixa (6 chips, a Janete no centro). */
  cw: number;
  /** Da final: o vão entre dois chips vizinhos (onde fica a seta). */
  vao: number;
  /** Da final: a largura do lugar da Janete no centro da faixa. */
  nz: number;
  /** A largura da caixa da barra: cabe a barra em pé e a mini barra deitada. */
  bwCaixa: number;
}

/** As linhas fixas do cartão (px, a partir do topo do cartão). */
export const LINHAS = {
  /** Repouso: o topo da área das barras (abaixo do nome em 64, do número de 28 px em 80 e da conversão em 114). */
  barras0: 140,
  /** Aberto: o topo da área das barras (nome em 82, número de 44 px em 100, conversão em 154). */
  barras1: 186,
  quedaFolga: 18,
  /** A queda aberta: saíram, perdidos, sem resposta e ainda estão (4 linhas de 15 px). */
  quedaAltura: 64,
  metricaFolga: 14,
  metricaLinha: 36,
  recheioBaixo: 28,
  /**
   * Ajuste 4 do equipe: no cartão aberto, embaixo das métricas, a linha da pílula "Role para ver cada
   * etapa" (30 px de pílula, com 16 px até o pé): a pílula mora no pé do cartão, sem cobrir métrica.
   */
  dica: 34,
  faixa: 68,
  faixaTopo: 8,
  /** Onde a mini barra deita no chip (a partir do topo da faixa). */
  miniY: 53,
} as const;

/** A borda de baixo da mini barra do chip (miniY + 3 px): o pé da faixa fica 12 px abaixo dela. */
const FUNDO_MINI = LINHAS.miniY + 3;

const limitar = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));

export function geometria(m: MedidasPalco): GeometriaPalco {
  const L = LINHAS;
  const px = 28;
  const metricas = (m.admin ? 3 : 2) * L.metricaLinha;
  const fixo = L.barras1 + L.quedaFolga + L.quedaAltura + L.metricaFolga + metricas + L.recheioBaixo + L.dica;
  // aberto, o cartão ocupa ~92% da altura visível (a sobra vai para as barras)
  const alvo = Math.round(m.v * 0.92);
  const bh1 = Math.round(limitar(alvo - fixo, 170, 560));
  const h1 = fixo + bh1;
  const t1 = Math.max(8, Math.round((m.v - h1) / 2));
  const bh0 = Math.min(104, Math.round(bh1 * 0.6));
  const base0 = L.barras0 + bh0;
  const base1 = L.barras1 + bh1;
  // em repouso, o cartão termina logo abaixo das barras (o "Pergunte à Janete" fica no fim dos capítulos)
  const h0 = base0 + L.recheioBaixo;
  const sw = Math.max(60, (m.w - 2 * px) / 5.82);
  const bw = sw * 0.6;
  // A faixa da final: 16 px de cada lado, 6 chips, 4 vãos de seta (entre Novo, Em qualificação e
  // Qualificado; entre Em negociação, Ganho e "Para onde foram") e o lugar da Janete no centro.
  const vao = 24;
  const nz = m.w >= 1000 ? 84 : 72;
  const cw = Math.max(56, (m.w - 32 - 4 * vao - nz) / 6);
  const mini = Math.max(24, cw - 24);
  return {
    v: m.v,
    px,
    h0,
    h1,
    hs: L.faixa,
    t1,
    t2: L.faixaTopo,
    bh0,
    bh1,
    base0,
    base1,
    hmax: Math.max(h0, h1),
    sw,
    bw,
    mini,
    bwCaixa: Math.max(bw, mini),
    cw,
    vao,
    nz,
  };
}

/** A folga entre a borda de baixo do cartão e a do fundo de tela que vai com ele (fase 3). */
const FOLGA_FUNDO = 14;
/** O trecho (px, metade para cada lado do t1) em que o cartão, que vinha 1 para 1 com a página,
 * desacelera até parar no t1. */
const SUAVE_PARADA = 30;

/**
 * Onde a rolagem está em relação ao palco: `antes` é a distância do topo visível até o palco com a
 * rolagem no começo (no máximo uma tela) e `alcance` é antes + a viagem do trilho. Com eles se sabe,
 * para cada `p`, quanto falta para a vista prender (`antes − p × alcance`, positivo enquanto ela ainda
 * sobe com a página).
 */
export interface Rolagem {
  antes: number;
  alcance: number;
}

/**
 * A distância até o t1 depois da suavização (um máximo suave entre x e 0): igual à de entrada a partir
 * de `w` px, zero abaixo de −w e uma parábola entre os dois (contínua e com a derivada contínua). O
 * cartão nunca passa à frente da página: fica no máximo w/4 px atrás dela, e para sem tranco.
 */
function chegarParado(x: number, w: number): number {
  if (w <= 0) return Math.max(0, x);
  if (x >= w) return x;
  if (x <= -w) return 0;
  return ((x + w) * (x + w)) / (4 * w);
}

/**
 * O recipiente num quadro: a posição (na vista), a altura e o raio do cartão, e a borda de baixo do
 * fundo de tela que fica atrás dele.
 *
 * Fase 1: a posição é calculada na TELA. O cartão anda 1 para 1 com a página (os números de cima e o
 * funil saem juntos, sem vão) até o topo chegar perto do t1, e desacelera num trecho de 60 px até parar
 * nele; a vista que sobe com a página (até prender) é descontada. Só a altura cresce pela curva.
 *
 * Fase 3: o pé do cartão sobe junto com o conteúdo, nunca à frente dele. Primeiro até 12 px abaixo da
 * base das barras (`esvazia`, enquanto as métricas e as quedas somem), e, na mesma janela das barras
 * deitando, o cartão inteiro vira a faixa com o progresso da fileira (`ind`): a base das barras vai de
 * base1 até o pé da mini barra, e o pé do cartão vem 12 px abaixo dela. Nenhuma faixa branca vazia
 * sobra embaixo.
 *
 * Fundo: termina sempre 14 px abaixo do cartão (no fim, é a faixa de tela atrás do índice). Os
 * capítulos nunca aparecem em volta do funil porque o motor empurra o 1º para baixo do pé do cartão
 * (`deslocamentoDoCapitulo`).
 */
export function recipiente(
  c: Camadas,
  g: Pick<GeometriaPalco, "v" | "h0" | "h1" | "hs" | "t1" | "t2" | "base0" | "base1">,
  r: Rolagem,
) {
  // Fase 1: o pé do cartão acompanha a base das barras (que desce de base0 a base1 com o recipiente),
  // sempre a mesma folga de repouso abaixo dela; a área das quedas e das métricas só abre com `pe`.
  const folgaRepouso = g.h0 - g.base0;
  const ch =
    g.h0 +
    (g.base1 - g.base0) * c.cresce +
    (g.h1 - g.base1 - folgaRepouso) * c.pe -
    (g.h1 - g.base1 - (g.hs - FUNDO_MINI)) * c.esvazia -
    (g.base1 - FUNDO_MINI) * c.ind;
  const antes = Math.max(0, r.antes);
  // onde a página levaria o topo do palco nesta rolagem (na tela)
  const pagina = antes - c.p * r.alcance;
  const topoTela =
    antes >= g.t1
      ? // a parada termina antes de a vista prender (no quadro em que ela prende, o cartão já está parado)
        g.t1 + chegarParado(pagina - g.t1, Math.max(0, Math.min(SUAVE_PARADA, antes - g.t1, g.t1 - 4)))
      : antes - (antes - g.t1) * c.cresce;
  const vistaAbaixo = Math.max(0, pagina);
  const cy = topoTela - vistaAbaixo + (g.t2 - g.t1) * c.ind;
  const fundo = cy + ch + FOLGA_FUNDO;
  // vy: quanto a vista (que ainda sobe com a página) está abaixo do topo visível; cy + vy é o topo do
  // cartão na tela
  return { ch, cy, cr: 24 - 8 * c.cresce, fundo, vy: vistaAbaixo };
}

/** A pílula "Role para ver cada etapa": a altura, a distância abaixo do pé do cartão e a do fim da tela. */
export const DICA = { altura: 30, abaixo: 12, dentro: 46, margemTela: 16 } as const;

/**
 * Onde a pílula fica (px, do topo do cartão), ajuste 4 do equipe. Antes do pé abrir, ela fica centralizada
 * logo embaixo do cartão; com o pé aberto, desce para a linha dela no pé do cartão (16 px acima do fim,
 * embaixo das métricas). Nunca passa do fim da tela: na dobra, quando o pé do cartão ainda está abaixo
 * da dobra, ela fica 16 px acima do fim da tela, sobre o começo das barras.
 */
export function posicaoDaDica(c: Pick<Camadas, "pe">, r: { ch: number; cy: number; vy: number }, v: number): number {
  const noCartao = r.ch + DICA.abaixo - (DICA.abaixo + DICA.dentro) * c.pe;
  const fimDaTela = v - DICA.margemTela - DICA.altura - (r.cy + r.vy);
  return Math.min(noCartao, fimDaTela);
}

/** A distância mínima entre o pé do cartão e o topo do 1º capítulo (o título dele cabe inteiro, sem encostar). */
export const FOLGA_CAPITULO = 40;

/**
 * Quanto o 1º capítulo se desloca (px) para ficar colado embaixo do cartão: `topoNatural` é onde ele
 * estaria na vista sem deslocamento e `folga` é a distância dele até o pé do cartão (o motor usa a de
 * p = 1, ~48 px: 124 do topo menos os 76 da faixa, para o deslocamento chegar a zero exatamente em p = 1).
 * Antes da fase 3 ele só desce (nunca aparece em volta do funil); na fase 3 ele também sobe, colado ao pé
 * do cartão que encolhe: o título nasce logo embaixo do funil, sem um vão vazio no meio. Contínuo: no
 * começo da fase 3 o cartão ainda é alto, e os dois cálculos dão o mesmo valor (positivo).
 */
export function deslocamentoDoCapitulo(p: number, r: { cy: number; ch: number }, topoNatural: number, folga: number): number {
  const bruto = r.cy + r.ch + folga - topoNatural;
  return p >= FAIXAS.indice[0] ? bruto : Math.max(0, bruto);
}

/**
 * As variáveis CSS de um quadro (nome → valor já em texto), para o motor escrever na vista presa. O
 * `--p` vai à parte, no próprio [data-dash="palco"] (spec 14.5). As sombras são camadas fixas: a do
 * repouso e a do aberto só mudam de escala e de opacidade (`--dvb-sa` e `--dvb-sb`: a altura do cartão
 * sobre a altura de cada uma), e a da faixa acompanha o pé do cartão só pela posição. Nenhuma sombra é
 * recalculada a cada quadro.
 */
export function variaveisDoQuadro(c: Camadas, g: GeometriaPalco, rolagem: Rolagem): [string, string][] {
  const f = (x: number) => x.toFixed(4);
  const r = recipiente(c, g, rolagem);
  const escala = (h: number) => (h > 0 ? f(r.ch / h) : "1");
  const lista: [string, string][] = [
    ["--dvb-cy", `${r.cy.toFixed(2)}px`],
    ["--dvb-ch", `${r.ch.toFixed(2)}px`],
    ["--dvb-cr", `${r.cr.toFixed(2)}px`],
    ["--dvb-fundo", `${r.fundo.toFixed(2)}px`],
    ["--dvb-dica-y", `${posicaoDaDica(c, r, g.v).toFixed(2)}px`],
    ["--dvb-sa", escala(g.h0)],
    ["--dvb-sb", escala(g.h1)],
    ["--a-dica", f(c.dica)],
    ["--a-cresce", f(c.cresce)],
    ["--a-veu", f(c.veu)],
    ["--a-sombra-a", f(c.sombraA)],
    ["--a-sombra-b", f(c.sombraB)],
    ["--a-sombra-c", f(c.sombraC)],
    ["--a-titulo", f(c.titulo)],
    ["--a-sai", f(c.sai)],
    ["--a-ind", f(c.ind)],
    ["--a-lado", f(c.lado)],
    ["--a-janete", f(c.janete)],
    ["--a-chip", f(c.chip)],
  ];
  for (let i = 0; i < N_COLUNAS; i += 1) {
    lista.push([`--b${i}`, f(c.b[i] ?? 0)]);
    lista.push([`--n${i}`, f(c.n[i] ?? 0)]);
    lista.push([`--m${i}`, f(c.m[i] ?? 0)]);
    lista.push([`--q${i}`, f(c.q[i] ?? 0)]);
    lista.push([`--d${i}`, f(c.d[i] ?? 0)]);
  }
  return lista;
}

/** As variáveis da geometria (só mudam no redimensionamento). */
export function variaveisDaGeometria(g: GeometriaPalco): [string, string][] {
  const px = (x: number) => `${x.toFixed(2)}px`;
  return [
    ["--g-v", px(g.v)],
    ["--g-px", px(g.px)],
    ["--g-h0", px(g.h0)],
    ["--g-h1", px(g.h1)],
    ["--g-hs", px(g.hs)],
    ["--g-t1", px(g.t1)],
    ["--g-t2", px(g.t2)],
    ["--g-bh0", px(g.bh0)],
    ["--g-bh1", px(g.bh1)],
    ["--g-base0", px(g.base0)],
    ["--g-base1", px(g.base1)],
    ["--g-hmax", px(g.hmax)],
    ["--g-sw", px(g.sw)],
    ["--g-bw", px(g.bw)],
    ["--g-mini", px(g.mini)],
    ["--g-bwcaixa", px(g.bwCaixa)],
    ["--g-cw", px(g.cw)],
    ["--g-vao", px(g.vao)],
    ["--g-nz", px(g.nz)],
  ];
}
