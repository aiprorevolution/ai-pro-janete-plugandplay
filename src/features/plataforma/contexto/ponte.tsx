import { useMemo, type ReactNode } from "react";

import { useAcoesContextoBanco, useHistoricoContexto, useVersaoContexto } from "../dados/contexto";
import { useDados } from "../dados/ProvedorDados";
import type { VersaoContextoBanco } from "../dados/tipos";
import { ProvedorFonteContexto, useVendoContexto, type FonteContexto, type RespostaGravacao } from "./loja";
import { erroDaTela, paraVersao, type QuemSalvou } from "./regras";
import type { VersaoContexto } from "./tipos";

// A ponte do Contexto com o banco (task C6): lê pela camada de dados e põe a fonte das versões para a
// loja (loja.ts). A versão atual vem de useDados().useContextoAtual() (a de maior id); o histórico e a
// versão aberta, de dados/contexto.ts; "quem salvou", de useEu() e useMembros() (inclui os inativos).
// Salvar e restaurar vão pelas rpcs contexto_salvar e contexto_restaurar.

export function PonteContextoBanco({ children }: { children: ReactNode }) {
  const dados = useDados();
  const atualQ = dados.useContextoAtual();
  const { membro } = dados.useEu();
  const membrosQ = dados.useMembros();
  const historico = useHistoricoContexto();
  const vendo = useVendoContexto();
  const acoes = useAcoesContextoBanco();

  const quem = useMemo<QuemSalvou>(
    () => ({ euId: membro.id, nomes: new Map((membrosQ.dados ?? []).map((m) => [m.id, m.nome])) }),
    [membro.id, membrosQ.dados],
  );

  // as linhas lidas: a atual e as páginas (sem a 31ª de cada página, que só serve para o resumo)
  const paginas = historico.dados;
  const lidas = useMemo(() => {
    const porId = new Map<number, VersaoContextoBanco>();
    if (atualQ.dados) porId.set(atualQ.dados.id, atualQ.dados);
    for (const p of paginas ?? []) for (const l of p.linhas) if (!porId.has(l.id)) porId.set(l.id, l);
    return porId;
  }, [atualQ.dados, paginas]);

  // vendo uma versão que não está nas páginas lidas: busca só ela
  const fora = vendo !== null && !lidas.has(vendo) ? vendo : null;
  const extra = useVersaoContexto(fora);

  const versoes = useMemo<VersaoContexto[]>(() => {
    const numeros: Record<number, number> = {};
    // as de apoio (a 31ª de cada página) dão o resumo da última da página
    const apoio = new Map<number, VersaoContextoBanco>();
    for (const p of paginas ?? []) {
      Object.assign(numeros, p.numeros);
      if (p.anterior) apoio.set(p.anterior.id, p.anterior);
    }
    for (const l of lidas.values()) if (l.numero !== null) numeros[l.id] = l.numero;
    const linhas = [...lidas.values()].sort((a, b) => b.id - a.id);
    // a sequência contígua (do topo para baixo), onde a anterior de cada uma é a seguinte da lista
    const sequencia = [...linhas, ...[...apoio.values()].filter((l) => !lidas.has(l.id))].sort((a, b) => b.id - a.id);
    const convertidas = new Map<number, VersaoContexto>();
    // da mais velha para a mais nova, para cada uma já ter a anterior convertida
    for (let i = sequencia.length - 1; i >= 0; i--) {
      const l = sequencia[i]!;
      const ant = sequencia[i + 1];
      const anterior = ant ? convertidas.get(ant.id) : null;
      convertidas.set(l.id, paraVersao(l, { quem, anterior, numeros }));
    }
    const lista = linhas.map((l) => convertidas.get(l.id)!);
    // a versão buscada sozinha não tem a anterior: o resumo fica vazio (salvo a 1ª e a restauração)
    if (extra.dados && !lidas.has(extra.dados.id)) lista.push(paraVersao(extra.dados, { quem, numeros }));
    return lista.sort((a, b) => b.id - a.id);
  }, [lidas, paginas, extra.dados, quem]);

  const fonte = useMemo<FonteContexto>(
    () => ({
      modo: "banco",
      versoes,
      carregando: atualQ.carregando || membrosQ.carregando,
      erro: atualQ.erro ?? membrosQ.erro,
      // atualQ.dados é null sem nenhuma versão (já chegou); undefined = ainda não chegou
      pronta: atualQ.dados !== undefined && membrosQ.dados !== undefined,
      tentarDeNovo: () => {
        if (atualQ.erro) atualQ.tentarDeNovo();
        if (membrosQ.erro) membrosQ.tentarDeNovo();
      },
      historico: {
        carregando: historico.carregando,
        erro: historico.erro,
        tentarDeNovo: historico.tentarDeNovo,
        temMaisAntigas: historico.temMaisAntigas,
        carregarMaisAntigas: historico.carregarMaisAntigas,
        carregandoMaisAntigas: historico.carregandoMaisAntigas,
      },
      gravar: async (base, mudancas): Promise<RespostaGravacao> => {
        const r = await acoes.salvar(base, mudancas);
        if (r.ok) return r.valor ? { ok: true, ...r.valor } : { ok: false, erro: "falha" };
        const atual = r.atual === undefined ? undefined : r.atual ? paraVersao(r.atual, { quem }) : null;
        return { ok: false, erro: erroDaTela(r.erro), atual };
      },
      restaurar: async (id): Promise<RespostaGravacao> => {
        const r = await acoes.restaurar(id);
        if (r.ok) return r.valor ? { ok: true, ...r.valor } : { ok: false, erro: "falha" };
        return { ok: false, erro: erroDaTela(r.erro) };
      },
    }),
    [versoes, atualQ, membrosQ, historico, acoes, quem],
  );

  return <ProvedorFonteContexto value={fonte}>{children}</ProvedorFonteContexto>;
}
