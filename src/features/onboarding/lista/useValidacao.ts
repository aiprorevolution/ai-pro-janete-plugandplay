import { useCallback, useEffect, useRef, useState } from "react";

import { movimentoReduzido, rolarAteEMedir } from "@/components/janete/VooJanete";

import { GIRO_REDUZIDO_MS, VOLTA_MOEDA_MS, type Fase } from "./dados";
import { sessaoTerminou } from "./sessao";

/**
 * O resultado da chamada à função de servidor, ou a falha da própria chamada: `falha` (sem rede,
 * servidor fora) ou `sem_sessao` (a chamada foi recusada porque a sessão do Firebase terminou).
 */
export type Desfecho<R> = { tipo: "resposta"; valor: R } | { tipo: "falha" } | { tipo: "sem_sessao" };

export interface OpcoesValidar<R> {
  /** Chama a função de servidor. Começa junto com a animação. */
  chamar: () => Promise<R>;
  /**
   * Roda no fim (animação mínima e resposta, o que vier depois). Devolve a fase final: "qr" quando
   * o número ainda precisa ler o QR code (Z-API e Evolution desconectadas).
   */
  concluir: (desfecho: Desfecho<R>) => "ok" | "erro" | "qr";
}

export interface Validacao {
  fase: Fase;
  /** A fase de antes do "reabrindo" (o palco mostra ela enquanto some). */
  faseAntes: Fase | null;
  /** Linha de status ativa: 0, 1 e 2 durante o giro; 3 no fim (todas feitas). */
  passo: number;
  /**
   * Entre o clique em validar e a dobra, enquanto a página rola até o disco (até ~900 ms): a fase
   * ainda é "form", mas a chamada já saiu. A lista fica inert (CartaoLista) e as escolhas de motor,
   * modo e provedor não mudam nada, senão a validação seguia com a escolha antiga.
   */
  preparando: boolean;
  validar: <R>(opcoes: OpcoesValidar<R>) => void;
  /** Do ok, do erro ou do QR de volta ao formulário (o palco some em 180 ms). `aplicar` roda na volta. */
  reabrir: (aplicar?: () => void) => void;
  /** Marca a fase direto (estado inicial já validado, ou o ok sem animação). */
  definirFase: (fase: Fase) => void;
}

/** Trecho em que a moeda está parada de frente (62% a 108% da volta): o logo pousa sem salto. */
export function esperaAteParada(decorridoMs: number): number {
  const fase = ((decorridoMs % VOLTA_MOEDA_MS) + VOLTA_MOEDA_MS) % VOLTA_MOEDA_MS;
  if (fase >= 700 && fase < 1150) return 0;
  return (((760 - fase) % VOLTA_MOEDA_MS) + VOLTA_MOEDA_MS) % VOLTA_MOEDA_MS;
}

/**
 * Antes de o cartão dobrar, o disco e o texto do resultado precisam estar inteiros na tela
 * (trazerCartao do F). A mira (`#disco-mira`, ver Lista.module.css) cobre do topo do disco ao fim
 * do texto: se ela não estiver inteira na vista, a página rola até ela, e só depois de a rolagem
 * PARAR a dobra começa (rolarAteEMedir). Antes, a dobra corria junto com a rolagem, e o disco
 * parecia escorregar na tela.
 */
export async function trazerCartao(): Promise<void> {
  if (typeof document === "undefined") return;
  await rolarAteEMedir("disco-mira", { bloco: "center" });
}

/**
 * A coreografia da validação (validar e reabrir do F), igual no WhatsApp e na IA:
 * form → fechando (o cartão dobra no disco, 680 ms) → verificando (a moeda gira e as linhas de
 * status andam pelo tempo) → ok ou erro. O resultado aparece no fim da duração mínima ou quando a
 * resposta chegar, o que vier depois; se a resposta atrasar, espera a moeda parar de frente.
 */
export function useValidacao(duracaoMs: number, faseInicial: Fase = "form"): Validacao {
  const [fase, setFase] = useState<Fase>(faseInicial);
  const [faseAntes, setFaseAntes] = useState<Fase | null>(null);
  const [passo, setPasso] = useState(0);
  const faseRef = useRef<Fase>(faseInicial);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const rodada = useRef(0);
  const preparando = useRef(false);
  const [preparandoTela, setPreparandoTela] = useState(false);

  const mudarFase = useCallback((f: Fase) => {
    faseRef.current = f;
    setFase(f);
  }, []);

  const depois = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  }, []);

  const limpar = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
  }, []);

  useEffect(() => {
    const lista = timers.current;
    return () => {
      rodada.current += 1;
      lista.forEach(clearTimeout);
      lista.clear();
    };
  }, []);

  const validar = useCallback(
    <R>({ chamar, concluir }: OpcoesValidar<R>) => {
      const atual = faseRef.current;
      if (atual !== "form" && atual !== "erro" && atual !== "qr") return;
      // um clique só: enquanto a página rola até o disco, o segundo clique não chama de novo
      if (preparando.current) return;
      limpar();
      const id = ++rodada.current;
      const mov = !movimentoReduzido();
      // "Tentar de novo" sai do erro com o disco já montado; o QR lido sai do passo do QR também
      const jaFechada = atual === "erro" || atual === "qr";

      // a chamada sai na hora do clique, junto com a animação
      let pedido: Promise<R>;
      try {
        pedido = Promise.resolve(chamar());
      } catch (falha) {
        pedido = Promise.reject(falha);
      }
      const resposta: Promise<Desfecho<R>> = pedido.then(
        (valor): Desfecho<R> => ({ tipo: "resposta", valor }),
        async (): Promise<Desfecho<R>> => ((await sessaoTerminou()) ? { tipo: "sem_sessao" } : { tipo: "falha" }),
      );

      const comecar = () => {
        preparando.current = false;
        setPreparandoTela(false);
        if (id !== rodada.current) return;
        const t0 = jaFechada ? 0 : mov ? 680 : 60;
        const V = mov ? duracaoMs : GIRO_REDUZIDO_MS;
        const inicio = Date.now();

        setPasso(0);
        mudarFase(jaFechada ? "verificando" : "fechando");
        if (!jaFechada) depois(() => mudarFase("verificando"), t0);
        depois(() => setPasso(1), t0 + Math.round(V * 0.36));
        depois(() => setPasso(2), t0 + Math.round(V * 0.7));
        const minimo = new Promise<void>((resolver) => depois(resolver, t0 + V));

        void Promise.all([resposta, minimo]).then(([desfecho]) => {
          if (id !== rodada.current) return;
          const girando = Date.now() - inicio - t0;
          const espera = mov ? esperaAteParada(girando) : 0;
          const terminar = () => {
            if (id !== rodada.current) return;
            const final = concluir(desfecho);
            setPasso(3);
            mudarFase(final);
          };
          if (espera > 0) depois(terminar, espera);
          else terminar();
        });
      };

      if (jaFechada) {
        comecar();
        return;
      }
      // o cartão só dobra com a página parada e o disco inteiro na vista
      preparando.current = true;
      setPreparandoTela(true);
      trazerCartao().then(comecar, comecar);
    },
    [depois, duracaoMs, limpar, mudarFase],
  );

  const reabrir = useCallback(
    (aplicar?: () => void) => {
      const atual = faseRef.current;
      if (atual !== "ok" && atual !== "erro" && atual !== "qr") return;
      limpar();
      rodada.current += 1;
      if (movimentoReduzido()) {
        aplicar?.();
        mudarFase("form");
        return;
      }
      setFaseAntes(atual);
      mudarFase("reabrindo");
      depois(() => {
        aplicar?.();
        mudarFase("form");
      }, 180);
    },
    [depois, limpar, mudarFase],
  );

  const definirFase = useCallback(
    (f: Fase) => {
      limpar();
      rodada.current += 1;
      preparando.current = false;
      setPreparandoTela(false);
      mudarFase(f);
    },
    [limpar, mudarFase],
  );

  return { fase, faseAntes, passo, preparando: preparandoTela, validar, reabrir, definirFase };
}
