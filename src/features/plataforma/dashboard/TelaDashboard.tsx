import { lazy, Suspense, useEffect } from "react";

import type { Classes } from "@/components/aipro/cx";

import { Carregando, ErroLeitura } from "../dados/estados";
import { ID_TITULO_DASHBOARD, ProvedorPainel, useEstadoPainel } from "./dados";
import estilos from "./TelaDashboard.module.css";

// O Dashboard (docs/spec-dashboard.md e docs/spec-dashboard-final.md): a versão final, que o equipe
// aprovou em 01/11/2026. O `TelaDashboard` põe o `ProvedorPainel` em volta da tela.
//
// Os 3 estados (spec de ligar as telas ao banco, task C4): enquanto as leituras não chegaram, o h1
// (a saudação, com o id que a casca foca) e o osso dos cartões; se a 1ª leitura falhar, o erro com
// "Tentar de novo"; com os números na tela, uma releitura que falhou vira um aviso compacto em cima
// (os números de antes continuam). O período sem nada é o vazio da própria tela (painel.vazio).
//
// A tela carrega sob demanda (lazy): a árvore de rotas, e os testes das outras telas que a importam,
// não carregam o código do Dashboard. O download começa quando o Dashboard abre, junto com as leituras
// (antes, só depois delas, com a área em branco no meio); até ele chegar, fica o mesmo osso da espera.

const importarTelaFinal = () => import("./versoes/final/TelaDashboardFinal");
const TelaFinal = lazy(() => importarTelaFinal().then((m) => ({ default: m.TelaDashboardFinal })));

const s = estilos as Classes<"espera" | "titulo" | "avisoTopo">;

interface PropsTela {
  /** O relógio (testes fixam). */
  relogio?: (() => Date) | undefined;
}

export function TelaDashboard({ relogio }: PropsTela) {
  return (
    <ProvedorPainel relogio={relogio}>
      <ConteudoDashboard />
    </ProvedorPainel>
  );
}

function ConteudoDashboard() {
  const { pronto, erro, tentarDeNovo, saudacao } = useEstadoPainel();
  // Uma falha aqui (rede) fica para o lazy, que tenta de novo quando a tela final montar.
  useEffect(() => {
    importarTelaFinal().catch(() => undefined);
  }, []);

  if (!pronto) {
    return <Espera saudacao={saudacao} erro={erro} tentarDeNovo={tentarDeNovo} />;
  }

  return (
    <>
      {erro ? (
        <div className={s.avisoTopo}>
          <ErroLeitura erro={erro} tentarDeNovo={tentarDeNovo} titulo="Não deu para atualizar os números" compacto />
        </div>
      ) : null}
      <Suspense fallback={<Espera saudacao={saudacao} />}>
        <TelaFinal />
      </Suspense>
    </>
  );
}

interface PropsEspera {
  saudacao: string;
  /** A 1ª leitura falhou: o erro com "Tentar de novo" no lugar do osso. */
  erro?: ReturnType<typeof useEstadoPainel>["erro"] | undefined;
  tentarDeNovo?: (() => void) | undefined;
}

/** A espera do Dashboard: o h1 (a saudação, com o id que a casca foca) e o osso dos cartões, ou o erro. */
function Espera({ saudacao, erro, tentarDeNovo }: PropsEspera) {
  return (
    <section className={s.espera} data-area="dashboard" data-dash="pagina" aria-labelledby={ID_TITULO_DASHBOARD} aria-busy={!erro || undefined}>
      <h1 id={ID_TITULO_DASHBOARD} tabIndex={-1} className={s.titulo}>
        {saudacao}
      </h1>
      {erro && tentarDeNovo ? (
        <ErroLeitura erro={erro} tentarDeNovo={tentarDeNovo} titulo="Não deu para carregar o Dashboard" />
      ) : (
        <Carregando forma="cartao" quantos={4} rotulo="Carregando o Dashboard" />
      )}
    </section>
  );
}
