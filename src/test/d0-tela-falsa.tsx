import { ID_TITULO_DASHBOARD, usePainelDashboard, type ValorPainelDashboard } from "@/features/plataforma/dashboard/dados";

let ultimoValor: ValorPainelDashboard | null = null;

/** O último valor do painel que a tela de mentira recebeu (para o teste trocar o período pela tela). */
export function valorDaTelaFalsa(): ValorPainelDashboard | null {
  return ultimoValor;
}

/**
 * Uma tela de mentira do Dashboard, para os testes da fundação (d0-tela-dashboard) não dependerem da
 * tela de verdade (versoes/final, com o teste dv-versao-final): segue as regras da tela (o h1 com a
 * saudação e o id que a casca foca, a raiz com aria-labelledby e data-area) e mostra a linha de resumo
 * do painel.
 */
export function TelaFalsa() {
  const valor = usePainelDashboard();
  ultimoValor = valor;
  const { painel } = valor;
  return (
    <section data-area="dashboard" data-dash="pagina" aria-labelledby={ID_TITULO_DASHBOARD}>
      <h1 id={ID_TITULO_DASHBOARD} tabIndex={-1}>
        {painel.textos.saudacao}
      </h1>
      <p>{painel.textos.resumo}</p>
      <p>Tela de mentira</p>
    </section>
  );
}
