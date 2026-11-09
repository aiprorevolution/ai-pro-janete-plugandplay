import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { Esqueleto } from "@/components/aipro";
import { type Classes } from "@/components/aipro/cx";

import { areaPorId, type AreaId, type FormaVazio } from "./areas";
import estilos from "./AreaVazia.module.css";
import { Carregando, type FormaCarregando } from "./dados/estados";

const s = estilos as Classes<
  "vista" | "cab" | "titulo" | "descricao" | "vazioPlat" | "esboco" | "curto" | "vazioTitulo" | "vazioTexto"
>;

/** Id do título de uma área: o foco vai para ele quando um atalho da Janete abre a área. */
export function idTituloArea(area: AreaId): string {
  return `area-${area}`;
}

/** Uma visita: a área do endereço e o número que a casca pediu para ela (`novaVisita`). */
export interface Visita {
  area: AreaId;
  n: number;
}

/**
 * A visita de agora: a casca (Layout.tsx) pede um número novo a cada troca de área e passa, com a
 * área do endereço, em volta do Outlet. Fora da casca (testes de uma tela sozinha) não há visita, e
 * toda vista entra animada.
 */
export const VisitaDaArea = createContext<Visita | null>(null);

/** A contagem é da aba, e não da casca: a casca que monta de novo (sair e entrar) não repete número. */
let visitas = 0;

/** Um número de visita que nenhuma troca de área usou ainda nesta aba. */
export function novaVisita(): number {
  visitas += 1;
  return visitas;
}

/** A última vista que montou: de qual área e em qual visita. */
let ultimaVista: { area: AreaId; visita: number } | null = null;

/**
 * Se a vista que está montando roda a animação de entrada. A entrada roda uma vez por troca de área:
 * a vista que monta de novo na mesma visita (o esqueleto da troca, depois a tela "carregando" da área,
 * depois a pronta) aparece sem animação. Antes, a área sumia e aparecia de novo quando os dados
 * chegavam (medido em 02/11: na Configuração, entradas aos 97 e aos 380 ms do clique). A `VistaArea`
 * e o `CarregandoArea` usam; a área com raiz própria (a Equipe) também, nas raízes dela.
 *
 * A vista de outra área que não a do endereço é a anterior, que ainda monta enquanto a nova chega (os
 * dados dela chegaram no meio da troca): não anima nem conta, senão tiraria a entrada da área nova.
 */
export function useEntradaUnica(area: AreaId): boolean {
  const visita = useContext(VisitaDaArea);
  const [montagem] = useState((): { conta: number | null; anima: boolean } => {
    if (visita === null) return { conta: null, anima: true };
    if (visita.area !== area) return { conta: null, anima: false };
    return { conta: visita.n, anima: ultimaVista?.area !== area || ultimaVista.visita !== visita.n };
  });
  useEffect(() => {
    if (montagem.conta !== null) ultimaVista = { area, visita: montagem.conta };
  }, [area, montagem]);
  return montagem.anima;
}

/**
 * As 3 barras do esboço (o `.esboco` do F): `true` é a barra curta. O Chat do F usa curta, longa,
 * curta; os Contatos (uma tabela), curta, longa, longa.
 */
function barrasDoEsboco(forma: FormaVazio): readonly boolean[] {
  return forma === "tabela" ? [true, false, false] : [true, false, true];
}

/**
 * A vista de uma área (o `.vista` e o `.vista-cab` do F): o título (h1, alvo do foco quando um
 * atalho da Janete abre a área), a frase do F e o conteúdo.
 */
export function VistaArea({ area, children }: { area: AreaId; children: ReactNode }) {
  const a = areaPorId(area);
  const id = idTituloArea(area);
  const anima = useEntradaUnica(area);
  return (
    <section aria-labelledby={id} data-area={area} data-sem-entrada={anima ? undefined : ""} className={s.vista}>
      <div className={s.cab}>
        <h1 id={id} tabIndex={-1} className={s.titulo}>
          {a.nome}
        </h1>
        <p className={s.descricao}>{a.descricao}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * Quanto a troca de área espera o código da área nova antes de mostrar o esqueleto dela (o `pendingMs`
 * das rotas de src/routes/app/). Com o código já baixado, a troca leva poucos ms e o esqueleto nem
 * aparece; o `pendingMinMs` das rotas é 0, para a área entrar assim que o código chegar.
 */
export const ESPERA_ESQUELETO_MS = 100;

/**
 * O osso de cada área enquanto o código dela chega: a forma e a contagem da tela "carregando" dela.
 * O Dashboard tem o título em osso: a espera dele mostra a saudação, que depende da hora e do nome.
 */
const OSSO_DA_AREA: Record<AreaId, { forma: FormaCarregando; quantos: number; frase: boolean; tituloEmOsso?: true }> = {
  chat: { forma: "lista", quantos: 6, frase: true },
  contatos: { forma: "lista", quantos: 6, frase: false },
  kanban: { forma: "cartao", quantos: 4, frase: true },
  dashboard: { forma: "cartao", quantos: 4, frase: false, tituloEmOsso: true },
  equipe: { forma: "cartao", quantos: 3, frase: true },
  contexto: { forma: "cartao", quantos: 3, frase: true },
  configuracao: { forma: "cartao", quantos: 5, frase: true },
};

/**
 * A área enquanto o código dela chega (o `pendingComponent` das rotas de src/routes/app/), ou enquanto
 * a casca espera a troca terminar (Layout.tsx). O código de cada área é um arquivo à parte, baixado na
 * 1ª visita: o topo e o menu já mostram a área nova, e sem isto o conteúdo da anterior ficava na tela
 * até o arquivo chegar (02/11: 620 a 800 ms com o código levando 600 ms). Mostra o título, a frase
 * (onde a área tem) e o osso da tela "carregando" da área.
 *
 * O h1 fica sem o id do foco: o foco vai para o h1 da área, quando ela abre. O esqueleto aparece de
 * uma vez, sem a animação de entrada (que começa transparente e deixaria a tela quase em branco no
 * lugar da área anterior), e conta a visita: a área entra no lugar dele, também sem animação.
 */
export function CarregandoArea({ area }: { area: AreaId }) {
  const a = areaPorId(area);
  const osso = OSSO_DA_AREA[area];
  useEntradaUnica(area);
  return (
    <section aria-label={a.nome} data-area={area} data-carregando-area="" data-sem-entrada="" className={s.vista}>
      <div className={s.cab}>
        {osso.tituloEmOsso ? (
          <h1 className={s.titulo} aria-label={a.nome}>
            <Esqueleto largura="16rem" altura="1.2em" />
          </h1>
        ) : (
          <h1 className={s.titulo}>{a.nome}</h1>
        )}
        {osso.frase ? <p className={s.descricao}>{a.descricao}</p> : null}
      </div>
      <Carregando forma={osso.forma} quantos={osso.quantos} rotulo={`Carregando ${a.nome}`} />
    </section>
  );
}

/**
 * Conteúdo de uma área nesta onda: o título, a frase do F e o estado vazio do F (`.vazio-plat`:
 * caixa tracejada centralizada, esboço de 3 barras, título e texto). Sem dado de exemplo e sem
 * ação (as ações chegam com o banco, na onda 2).
 */
export function AreaVazia({ area }: { area: AreaId }) {
  const a = areaPorId(area);
  return (
    <VistaArea area={area}>
      <div className={s.vazioPlat}>
        <div className={s.esboco} aria-hidden="true">
          {barrasDoEsboco(a.vazio.forma).map((curta, i) => (
            <span key={i} className={curta ? s.curto : undefined} />
          ))}
        </div>
        <h2 className={s.vazioTitulo}>{a.vazio.titulo}</h2>
        <p className={s.vazioTexto}>{a.vazio.texto}</p>
      </div>
    </VistaArea>
  );
}
