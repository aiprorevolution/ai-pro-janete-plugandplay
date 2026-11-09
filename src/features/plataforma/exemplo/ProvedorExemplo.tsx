import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { usePapel } from "../papel";
import { criarEstadoInicial } from "./dados";
import { reduzir } from "./reducer";
import { ehAdmin, membroDoPapel } from "./regras";
import type { AcaoExemplo, AcoesExemplo, EstadoBase, EstadoExemplo, ResultadoExemplo, StatusMensagem } from "./tipos";

// O provedor do modo exemplo: guarda o estado em memória (recarregar volta ao começo; nada vai ao
// banco) e dá às telas `useExemplo()` → { estado, acoes }. Ligar ao banco depois é trocar este
// provedor por um que leia e grave de verdade, com o mesmo contrato.
//
// `eu` vem do papel (usePapel): admin = "Você", atendente = Marina. Sem o "Ver como", que saiu do topo
// em 30/10, o exemplo fica como admin; o atendente volta quando o papel vier da conta. Cada ação roda o reducer
// puro na hora, contra o estado mais recente (ref), e devolve o resultado na mesma chamada: a tela
// sabe na hora se foi recusada (sem_permissao, sem_conexao_ativa, janela_fechada).
//
// Como no banco, só o admin lê as chaves de IA, os custos e a auditoria (policies ia_chaves_admin_le,
// ia_chamadas_admin_le e auditoria_admin_le): para a atendente, as três listas chegam vazias. Os
// convites da Equipe também (premissa da spec da Equipe: o atendente não vê convite pendente).

interface ValorExemplo {
  estado: EstadoExemplo;
  acoes: AcoesExemplo;
}

const ExemploContexto = createContext<ValorExemplo | null>(null);

/** Os passos de uma mensagem enviada pela tela, como no Chat final (ms depois do envio). */
export const PASSOS_DO_ENVIO: readonly (readonly [StatusMensagem, number])[] = [
  ["enviando", 350],
  ["enviada", 1000],
  ["entregue", 1900],
  ["lida", 5200],
];

interface Props {
  children: ReactNode;
  /** Estado de partida (testes e simulações). Sem ele, o exemplo completo de `criarEstadoInicial`. */
  inicial?: EstadoBase | (() => EstadoBase) | undefined;
  /** As mensagens enviadas andam sozinhas (fila → enviando → enviada → entregue → lida). Padrão: sim. */
  progredirEnvios?: boolean | undefined;
  /** O relógio (testes fixam). Padrão: `new Date()`. */
  relogio?: (() => Date) | undefined;
}

export function ProvedorExemplo({ children, inicial, progredirEnvios = true, relogio }: Props) {
  const { papel } = usePapel();
  const relogioRef = useRef(relogio ?? (() => new Date()));
  relogioRef.current = relogio ?? (() => new Date());

  const [base, setBase] = useState<EstadoBase>(() =>
    typeof inicial === "function" ? inicial() : (inicial ?? criarEstadoInicial(relogioRef.current())),
  );
  const atual = useRef(base);
  const eu = membroDoPapel(base.membros, papel);
  const euRef = useRef(eu);
  euRef.current = eu;
  const progredirRef = useRef(progredirEnvios);
  progredirRef.current = progredirEnvios;
  // A pausa da simulação da Janete (o botão do topo saiu em 30/10; a ação ficou para os testes do
  // Kanban): fica aqui, e não na tela do Kanban, para não se perder ao trocar de área. Não é dado do
  // banco: só diz se a Janete simulada dá o próximo passo.
  const [simulacaoPausada, setSimulacaoPausada] = useState(false);

  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  // A geração do andamento de cada mensagem: o "Tentar de novo" começa outra, e os passos que
  // sobraram do envio anterior deixam de valer (senão a situação voltaria para trás).
  const geracoes = useRef(new Map<string, number>());
  useEffect(() => {
    const lista = timers.current;
    return () => {
      lista.forEach(clearTimeout);
      lista.clear();
    };
  }, []);

  const acoes = useMemo<AcoesExemplo>(() => {
    const agora = () => relogioRef.current().toISOString();

    const aplicar = (acao: AcaoExemplo): ResultadoExemplo => {
      const r = reduzir(atual.current, { acao, euId: euRef.current.id, agora: agora() });
      if (r.estado !== atual.current) {
        atual.current = r.estado;
        setBase(r.estado);
      }
      return r.resultado;
    };

    const depois = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        timers.current.delete(t);
        fn();
      }, ms);
      timers.current.add(t);
    };

    // A mensagem que saiu da tela anda até "lida", um passo de cada vez. Se a conexão cair no meio,
    // o passo seguinte vira "falhou" (o "Tentar de novo" reenvia).
    const progredir = (mensagemId: string) => {
      if (!progredirRef.current) return;
      const g = (geracoes.current.get(mensagemId) ?? 0) + 1;
      geracoes.current.set(mensagemId, g);
      for (const [status, ms] of PASSOS_DO_ENVIO) {
        depois(() => {
          if (geracoes.current.get(mensagemId) !== g) return;
          const m = atual.current.mensagens.find((x) => x.id === mensagemId);
          if (!m || m.status === "falhou" || m.status === "cancelada" || m.status === "lida") return;
          const c = atual.current.conexao;
          const caiu = !c || !c.ativa || c.status !== "conectada";
          aplicar({
            tipo: "simularJanete",
            evento: caiu
              ? { tipo: "status_mensagem", mensagemId, status: "falhou", erro: "O WhatsApp está desconectado." }
              : { tipo: "status_mensagem", mensagemId, status },
          });
        }, ms);
      }
    };

    const comEnvio = (r: ResultadoExemplo) => {
      if (r.ok && r.id) progredir(r.id);
      return r;
    };

    return {
      enviarMensagem: (conversaId, mensagem) => comEnvio(aplicar({ tipo: "enviarMensagem", conversaId, mensagem })),
      assumir: (conversaId) => aplicar({ tipo: "assumir", conversaId }),
      devolverParaJanete: (conversaId) => aplicar({ tipo: "devolverParaJanete", conversaId }),
      marcarLida: (conversaId) => aplicar({ tipo: "marcarLida", conversaId }),
      reagir: (mensagemId, emoji) => aplicar({ tipo: "reagir", mensagemId, emoji }),
      tentarDeNovo: (mensagemId) => comEnvio(aplicar({ tipo: "tentarDeNovo", mensagemId })),
      moverEtapa: (contatoId, etapaId, ator) => aplicar({ tipo: "moverEtapa", contatoId, etapaId, ator }),
      editarContato: (contatoId, campos) => aplicar({ tipo: "editarContato", contatoId, campos }),
      editarEtapa: (etapaId, campos) => aplicar({ tipo: "editarEtapa", etapaId, campos }),
      reordenarEtapas: (ids) => aplicar({ tipo: "reordenarEtapas", ids }),
      apagarContato: (contatoId) => aplicar({ tipo: "apagarContato", contatoId }),
      simularJanete: (evento) => aplicar({ tipo: "simularJanete", evento }),
      trocarConexao: (nova) => aplicar({ tipo: "trocarConexao", nova }),
      trocarChaveIA: (finalidade, nova) => aplicar({ tipo: "trocarChaveIA", finalidade, nova }),
      salvarRitmo: (espera, teto) => aplicar({ tipo: "salvarRitmo", espera, teto }),
      escolherVoz: (voz) => aplicar({ tipo: "escolherVoz", voz }),
      salvarModoVoz: (modo) => aplicar({ tipo: "salvarModoVoz", modo }),
      convidarMembro: (email, papel) => aplicar({ tipo: "convidarMembro", email, papel }),
      reenviarConvite: (conviteId) => aplicar({ tipo: "reenviarConvite", conviteId }),
      cancelarConvite: (conviteId) => aplicar({ tipo: "cancelarConvite", conviteId }),
      trocarPapelMembro: (membroId, papel) => aplicar({ tipo: "trocarPapelMembro", membroId, papel }),
      desativarMembro: (membroId) => aplicar({ tipo: "desativarMembro", membroId }),
      reativarMembro: (membroId) => aplicar({ tipo: "reativarMembro", membroId }),
      recomecar: () => {
        timers.current.forEach(clearTimeout);
        timers.current.clear();
        geracoes.current.clear();
        const novo = criarEstadoInicial(relogioRef.current());
        atual.current = novo;
        setBase(novo);
      },
      alternarSimulacao: () => setSimulacaoPausada((p) => !p),
    };
  }, []);

  const valor = useMemo<ValorExemplo>(() => {
    const restrito = ehAdmin(eu) ? {} : { chaves: [], custos: [], auditoria: [], convites: [] };
    return { estado: { ...base, eu, ...restrito, simulacaoPausada }, acoes };
  }, [base, eu, acoes, simulacaoPausada]);
  return <ExemploContexto.Provider value={valor}>{children}</ExemploContexto.Provider>;
}

/** O exemplo da plataforma: `{ estado, acoes }`. Só dentro do `ProvedorExemplo` (o Layout põe). */
export function useExemplo(): ValorExemplo {
  const valor = useContext(ExemploContexto);
  if (!valor) throw new Error("useExemplo() precisa do <ProvedorExemplo> em volta (o Layout da plataforma põe).");
  return valor;
}
