import { useCallback, useEffect, useRef, useState } from "react";

import { lerImagemQr, type PedidoQr } from "@/features/servidor/qr-conexao";

import { MENSAGEM_SEM_RESPOSTA, MENSAGEM_SEM_SESSAO, mensagemDoResultado, separarMensagem } from "../../lista/dados";
import { sessaoTerminou } from "../../lista/sessao";

/**
 * Os tempos do passo do QR (spec-qr-whatsapp, decisão 1 e fatos da Z-API): o QR vale 20 s e se
 * renova 3 vezes; a situação é consultada a cada 3 s; sem imagem, pede de novo em 3 s, até 10
 * vezes; 3 falhas passageiras seguidas viram erro; a passkey vence em 10 min (o timeout do challenge).
 */
export const TEMPOS_QR = {
  vidaMs: 20_000,
  rodadas: 3,
  consultaMs: 3_000,
  repeteMs: 3_000,
  maxSemImagem: 10,
  falhasSeguidas: 3,
  passkeyMs: 600_000,
} as const;

/** A resposta de `pedir`, já no formato da tela (a camada de dados traduz o resultado do servidor). */
export type RespostaQr =
  | { ok: true; conectado: boolean; qr: string | null; passkey: boolean }
  | { ok: false; erro: string; mensagem?: string; campo?: string };

export type EstadoLeituraQr =
  | { tipo: "carregando" }
  | { tipo: "qr"; imagem: string; rodada: number; desde: number }
  | { tipo: "passkey" }
  | { tipo: "expirado" }
  | { tipo: "conectado" }
  | { tipo: "erro"; titulo: string; texto: string; semSessao: boolean };

/** Erros de rede e de prazo: contam como falha passageira (na 3ª seguida, viram erro). */
const PASSAGEIROS = new Set(["servidor_inacessivel", "tempo_esgotado"]);

/** A rejeição já traduzida pela camada da Configuração: segue o caminho da rejeição. */
const REJEICAO = "falha";

const MENSAGEM_DADOS_GUARDADOS =
  "Não conseguimos ler os dados guardados desta conexão. Cole os dados de novo.";

/** As mensagens próprias do passo (seção 2 da spec), consultadas antes de mensagemDoResultado. */
const MENSAGENS_QR: Readonly<Record<string, string>> = {
  sem_conexao: "Não há um WhatsApp conectado para mostrar o QR code. Conecte um número de novo.",
  nao_e_qr: "Este WhatsApp não conecta por QR code.",
  cifra_indisponivel: MENSAGEM_DADOS_GUARDADOS,
  cifra_invalida: MENSAGEM_DADOS_GUARDADOS,
  erro_ao_ler: MENSAGEM_DADOS_GUARDADOS,
};

/** Depois de 10 pedidos sem imagem. */
const MENSAGEM_QR_NAO_CHEGOU = "O QR code não chegou. Tente de novo em instantes.";

function mensagemQr(r: { erro: string; mensagem?: string }): string {
  return MENSAGENS_QR[r.erro] ?? mensagemDoResultado(r);
}

function estadoErro(mensagem: string, semSessao = false): EstadoLeituraQr {
  const { titulo, texto } = separarMensagem(mensagem);
  return { tipo: "erro", titulo, texto, semSessao };
}

/**
 * A leitura do QR code: pede o QR, consulta a situação até o celular conectar e renova o QR na
 * hora certa (regras na seção 2 da spec). Um pedido por vez: o próximo só sai depois da resposta
 * do anterior. Desligar (`ativo: false`), `gerarOutro` e desmontar invalidam a rodada em curso, e
 * a resposta que chegar depois é ignorada.
 *
 * StrictMode: o efeito liga, desliga e liga de novo. Cada ligada monta a própria máquina (variáveis
 * locais do efeito) e o primeiro pedido sai num temporizador de 0 ms, então a ligada desfeita não
 * chega a chamar o servidor.
 */
export function useLeituraQr(o: {
  ativo: boolean;
  pedir: (p: PedidoQr) => Promise<RespostaQr>;
  aoConectar: () => void;
}): { estado: EstadoLeituraQr; gerarOutro: () => void } {
  const { ativo } = o;
  const [estado, setEstado] = useState<EstadoLeituraQr>({ tipo: "carregando" });
  // `gerarOutro` muda este número e o efeito recomeça da rodada 1
  const [reinicio, setReinicio] = useState(0);
  // ao religar, o primeiro desenho já é "carregando" (ajuste no render, sem efeito): nunca
  // aparece o estado da ligada anterior
  const [ativoAntes, setAtivoAntes] = useState(ativo);
  if (ativo !== ativoAntes) {
    setAtivoAntes(ativo);
    if (ativo) setEstado({ tipo: "carregando" });
  }
  // a prop muda a cada render: o efeito lê sempre a última
  const pedirRef = useRef(o.pedir);
  const aoConectarRef = useRef(o.aoConectar);
  const ligada = useRef(0);
  const pendente = useRef(false);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    pedirRef.current = o.pedir;
    aoConectarRef.current = o.aoConectar;
  });

  useEffect(() => {
    if (!ativo) return;
    const id = ++ligada.current;
    const lista = timers.current;
    const vale = () => id === ligada.current;

    let modo: "qr" | "passkey" = "qr";
    let rodada = 0;
    let venceEm = 0;
    let passkeyAte = 0;
    let falhas = 0;
    let semImagem = 0;
    let terminou = false;

    const depois = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        lista.delete(t);
        fn();
      }, ms);
      lista.add(t);
    };
    const parar = (final: EstadoLeituraQr) => {
      terminou = true;
      lista.forEach(clearTimeout);
      lista.clear();
      setEstado(final);
    };

    // a hora de cada pedido: o QR (ou a passkey) venceu, ou é só mais uma consulta da situação
    const tique = () => {
      if (terminou) return;
      const agora = Date.now();
      if (modo === "passkey") {
        if (agora >= passkeyAte) return parar({ tipo: "expirado" });
        return chamar("situacao");
      }
      if (agora >= venceEm) {
        // a 3ª rodada vence em "expirado"; antes disso, um QR novo
        if (rodada >= TEMPOS_QR.rodadas) return parar({ tipo: "expirado" });
        // o QR na tela venceu: "carregando" até o novo chegar (nunca um QR vencido na tela)
        if (rodada > 0) setEstado({ tipo: "carregando" });
        return chamar("qr");
      }
      chamar("situacao");
    };

    // o próximo passo depois de uma resposta: em 3 s, ou antes, se o QR ou a passkey vencer
    const seguir = () => {
      if (terminou) return;
      const fim = modo === "passkey" ? passkeyAte : venceEm;
      const espera = Math.min(TEMPOS_QR.consultaMs, fim - Date.now());
      if (espera <= 0) tique();
      else depois(tique, espera);
    };

    // a renovação (rodada 2 ou 3) sem QR novo: o QR na tela já venceu, então volta a "carregando"
    const semQrNovo = (p: PedidoQr) => {
      if (p === "qr" && modo === "qr" && rodada > 0) setEstado({ tipo: "carregando" });
    };

    // falha passageira: na 3ª seguida vira erro; antes, repete o mesmo pedido
    const passageira = (p: PedidoQr, mensagem: string) => {
      falhas += 1;
      if (falhas >= TEMPOS_QR.falhasSeguidas) return parar(estadoErro(mensagem));
      semQrNovo(p);
      if (p === "qr") depois(() => chamar("qr"), TEMPOS_QR.repeteMs);
      else seguir();
    };

    // a chamada rejeitou (ou veio "falha", a rejeição já traduzida): sessão encerrada ou passageira
    const rejeitada = async (p: PedidoQr) => {
      const semSessao = await sessaoTerminou();
      if (!vale() || terminou) return;
      if (semSessao) return parar(estadoErro(MENSAGEM_SEM_SESSAO, true));
      passageira(p, MENSAGEM_SEM_RESPOSTA);
    };

    const responder = (p: PedidoQr, r: RespostaQr) => {
      if (!r.ok) {
        if (r.erro === REJEICAO) return void rejeitada(p);
        if (PASSAGEIROS.has(r.erro)) return passageira(p, mensagemQr(r));
        return parar(estadoErro(mensagemQr(r)));
      }
      falhas = 0;
      if (r.conectado) {
        parar({ tipo: "conectado" });
        aoConectarRef.current();
        return;
      }
      // a consulta da situação nunca traz QR: só segue esperando
      if (p === "qr" && modo === "qr") {
        // defesa extra: a imagem passa de novo por lerImagemQr; a que não passa conta como sem imagem
        const imagem = lerImagemQr(r.qr);
        if (r.passkey) {
          modo = "passkey";
          passkeyAte = Date.now() + TEMPOS_QR.passkeyMs;
          setEstado({ tipo: "passkey" });
        } else if (imagem) {
          rodada += 1;
          semImagem = 0;
          const desde = Date.now();
          venceEm = desde + TEMPOS_QR.vidaMs;
          setEstado({ tipo: "qr", imagem, rodada, desde });
        } else {
          // sem imagem ainda: pede de novo, sem contar rodada
          semImagem += 1;
          if (semImagem >= TEMPOS_QR.maxSemImagem) return parar(estadoErro(MENSAGEM_QR_NAO_CHEGOU));
          semQrNovo(p);
          depois(() => chamar("qr"), TEMPOS_QR.repeteMs);
          return;
        }
      }
      seguir();
    };

    const chamar = (p: PedidoQr) => {
      if (terminou || !vale() || pendente.current) return;
      pendente.current = true;
      let pedido: Promise<RespostaQr>;
      try {
        pedido = Promise.resolve(pedirRef.current(p));
      } catch (falha) {
        pedido = Promise.reject(falha);
      }
      pedido.then(
        (r) => {
          if (!vale()) return;
          pendente.current = false;
          if (!terminou) responder(p, r);
        },
        () => {
          if (!vale()) return;
          pendente.current = false;
          if (!terminou) void rejeitada(p);
        },
      );
    };

    // ao ligar: pede o QR (num temporizador, para a ligada que o StrictMode desfaz não chamar).
    // O "carregando" já veio no render (religar) ou no gerarOutro.
    depois(() => chamar("qr"), 0);

    return () => {
      ligada.current += 1;
      pendente.current = false;
      lista.forEach(clearTimeout);
      lista.clear();
    };
  }, [ativo, reinicio]);

  const gerarOutro = useCallback(() => {
    setEstado({ tipo: "carregando" });
    setReinicio((n) => n + 1);
  }, []);

  return { estado, gerarOutro };
}
