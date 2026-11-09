import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PassoQr, TEXTOS_QR } from "@/features/onboarding/conexao/qr/PassoQr";
import {
  TEMPOS_QR,
  useLeituraQr,
  type EstadoLeituraQr,
  type RespostaQr,
} from "@/features/onboarding/conexao/qr/useLeituraQr";
import type { PedidoQr } from "@/features/servidor/qr-conexao";

// Q2 (spec-qr-whatsapp, task F2): o useLeituraQr com relógio falso e o PassoQr em cada estado.

const sessao = vi.hoisted(() => ({ terminou: false }));
vi.mock("@/features/onboarding/lista/sessao", () => ({
  sessaoTerminou: vi.fn(async () => sessao.terminou),
  irParaEntrar: vi.fn(),
}));

const SEM_QR: RespostaQr = { ok: true, conectado: false, qr: null, passkey: false };
const CONECTADO: RespostaQr = { ok: true, conectado: true, qr: null, passkey: false };

/** Um servidor de mentira: cada "qr" devolve uma imagem nova; `conectado` vira na hora marcada. */
function servidor() {
  const chamadas: { p: PedidoQr; t: number }[] = [];
  const s = {
    conectado: false,
    /** Se definido, responde no lugar do padrão (pode devolver uma promessa presa). */
    resposta: null as ((p: PedidoQr, n: number) => Promise<RespostaQr>) | null,
    n: 0,
    chamadas,
    inicio: Date.now(),
    pedir: vi.fn((p: PedidoQr): Promise<RespostaQr> => {
      chamadas.push({ p, t: Date.now() - s.inicio });
      if (s.resposta) return s.resposta(p, chamadas.length);
      if (s.conectado) return Promise.resolve(CONECTADO);
      if (p === "qr") return Promise.resolve({ ok: true, conectado: false, qr: `data:image/png;base64,QR${++s.n}`, passkey: false });
      return Promise.resolve(SEM_QR);
    }),
    de: (p: PedidoQr) => chamadas.filter((c) => c.p === p).map((c) => c.t),
  };
  return s;
}

const Estrito = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;

function montar(s: ReturnType<typeof servidor>, estrito: boolean, ativo = true) {
  const aoConectar = vi.fn();
  const r = renderHook((props: { ativo: boolean; aoConectar: () => void }) => useLeituraQr({ ...props, pedir: s.pedir }), {
    initialProps: { ativo, aoConectar },
    ...(estrito ? { wrapper: Estrito } : {}),
  });
  return { ...r, aoConectar };
}

async function andar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-02T12:00:00-03:00"));
  sessao.terminou = false;
});
afterEach(() => {
  vi.useRealTimers();
});

describe.each([
  ["sem StrictMode", false],
  ["dentro de <StrictMode>", true],
])("useLeituraQr (%s)", (_nome, estrito) => {
  it("QR aos 0, 20 e 40 s; expirado aos 60 s; depois tudo para", async () => {
    const s = servidor();
    const { result } = montar(s, estrito);
    expect(result.current.estado).toEqual({ tipo: "carregando" });

    await andar(0);
    expect(s.de("qr")).toEqual([0]);
    expect(result.current.estado).toEqual({ tipo: "qr", imagem: "data:image/png;base64,QR1", rodada: 1, desde: s.inicio });

    await andar(20_000);
    expect(s.de("qr")).toEqual([0, 20_000]);
    expect(result.current.estado).toMatchObject({ tipo: "qr", rodada: 2, imagem: "data:image/png;base64,QR2", desde: s.inicio + 20_000 });

    await andar(20_000);
    expect(s.de("qr")).toEqual([0, 20_000, 40_000]);
    expect(result.current.estado).toMatchObject({ tipo: "qr", rodada: 3 });

    await andar(19_999);
    expect(result.current.estado.tipo).toBe("qr");
    await andar(1);
    expect(result.current.estado).toEqual({ tipo: "expirado" });

    const total = s.chamadas.length;
    await andar(120_000);
    expect(s.chamadas.length).toBe(total);
    expect(s.de("qr")).toEqual([0, 20_000, 40_000]);
  });

  it("com o QR na tela, consulta a situação a cada 3 s (o 20º segundo já é QR novo)", async () => {
    const s = servidor();
    montar(s, estrito);
    await andar(20_000);
    expect(s.de("situacao")).toEqual([3_000, 6_000, 9_000, 12_000, 15_000, 18_000]);
    await andar(20_000);
    expect(s.de("situacao").slice(6)).toEqual([23_000, 26_000, 29_000, 32_000, 35_000, 38_000]);
  });

  it("não empilha pedido: com uma consulta presa, nada mais sai até ela responder", async () => {
    const s = servidor();
    let soltar: (r: RespostaQr) => void = () => {};
    s.resposta = (p, n) => {
      if (p === "qr") return Promise.resolve({ ok: true, conectado: false, qr: `data:image/png;base64,Q${n}`, passkey: false });
      return new Promise<RespostaQr>((r) => (soltar = r));
    };
    const { result } = montar(s, estrito);
    await andar(3_000);
    expect(s.de("situacao")).toEqual([3_000]);
    await andar(30_000);
    expect(s.chamadas.length).toBe(2);
    expect(result.current.estado).toMatchObject({ tipo: "qr", rodada: 1 });
    // a consulta volta depois do vencimento: o próximo pedido já é o QR novo, na hora
    await act(async () => soltar(SEM_QR));
    await andar(0);
    expect(s.chamadas.map((c) => c.p)).toEqual(["qr", "situacao", "qr"]);
    expect(result.current.estado).toMatchObject({ tipo: "qr", rodada: 2, desde: s.inicio + 33_000 });
  });

  it("conectado: para tudo e chama aoConectar uma vez só (a última recebida)", async () => {
    const s = servidor();
    const { result, rerender, aoConectar } = montar(s, estrito);
    await andar(6_000);
    const novo = vi.fn();
    rerender({ ativo: true, aoConectar: novo });
    s.conectado = true;
    await andar(3_000);
    expect(result.current.estado).toEqual({ tipo: "conectado" });
    expect(novo).toHaveBeenCalledTimes(1);
    expect(aoConectar).not.toHaveBeenCalled();
    const total = s.chamadas.length;
    await andar(120_000);
    expect(s.chamadas.length).toBe(total);
    expect(novo).toHaveBeenCalledTimes(1);
  });

  it("o próprio pedido do QR pode voltar conectado (o número já tinha lido)", async () => {
    const s = servidor();
    s.conectado = true;
    const { result, aoConectar } = montar(s, estrito);
    await andar(0);
    expect(result.current.estado).toEqual({ tipo: "conectado" });
    expect(aoConectar).toHaveBeenCalledTimes(1);
    expect(s.chamadas).toEqual([{ p: "qr", t: 0 }]);
  });

  it("3 falhas passageiras seguidas (rejeição, servidor fora, tempo) viram erro; 1 sucesso zera a conta", async () => {
    const s = servidor();
    const respostas: Array<() => Promise<RespostaQr>> = [
      () => Promise.reject(new Error("rede")),
      () => Promise.resolve({ ok: false, erro: "tempo_esgotado" }),
      () => Promise.resolve({ ok: true, conectado: false, qr: "data:image/png;base64,UM", passkey: false }),
      () => Promise.reject(new Error("rede")),
      () => Promise.resolve({ ok: false, erro: "servidor_inacessivel", mensagem: "Não conseguimos falar com a Z-API. Tente de novo em instantes." }),
      () => Promise.resolve({ ok: false, erro: "tempo_esgotado", mensagem: "A Z-API demorou demais para responder. Tente de novo." }),
    ];
    s.resposta = (_p, n) => respostas[n - 1]!();
    const { result } = montar(s, estrito);
    await andar(0);
    expect(result.current.estado).toEqual({ tipo: "carregando" });
    await andar(3_000);
    expect(result.current.estado).toEqual({ tipo: "carregando" });
    await andar(3_000);
    expect(result.current.estado).toMatchObject({ tipo: "qr", rodada: 1 });
    await andar(3_000);
    await andar(3_000);
    expect(result.current.estado.tipo).toBe("qr");
    await andar(3_000);
    expect(result.current.estado).toEqual({
      tipo: "erro",
      titulo: "A Z-API demorou demais para responder.",
      texto: "Tente de novo.",
      semSessao: false,
    });
    expect(s.chamadas.map((c) => c.p)).toEqual(["qr", "qr", "qr", "situacao", "situacao", "situacao"]);
    await andar(60_000);
    expect(s.chamadas.length).toBe(6);
  });

  it("3 rejeições seguidas viram o erro de rede", async () => {
    const s = servidor();
    s.resposta = () => Promise.reject(new Error("rede"));
    const { result } = montar(s, estrito);
    await andar(6_000);
    expect(s.de("qr")).toEqual([0, 3_000, 6_000]);
    expect(result.current.estado).toEqual({
      tipo: "erro",
      titulo: "Não conseguimos fazer o teste agora.",
      texto: "Confira a sua internet e tente de novo em instantes.",
      semSessao: false,
    });
  });

  it("1 falha definitiva vira erro na hora, com a mensagem do servidor", async () => {
    const s = servidor();
    s.resposta = () =>
      Promise.resolve({ ok: false, erro: "credencial_invalida", mensagem: "A Z-API não aceitou os tokens. Confira o Client-Token." });
    const { result } = montar(s, estrito);
    await andar(0);
    expect(result.current.estado).toEqual({
      tipo: "erro",
      titulo: "A Z-API não aceitou os tokens.",
      texto: "Confira o Client-Token.",
      semSessao: false,
    });
    await andar(60_000);
    expect(s.chamadas.length).toBe(1);
  });

  it("falha definitiva sem mensagem usa a tabela de mensagens (sem_acesso)", async () => {
    const s = servidor();
    s.resposta = () => Promise.resolve({ ok: false, erro: "sem_acesso" });
    const { result } = montar(s, estrito);
    await andar(0);
    expect(result.current.estado).toMatchObject({ tipo: "erro", titulo: "Sua conta não pode configurar a Janete.", semSessao: false });
  });

  it("rejeição com a sessão encerrada vira erro semSessao na hora", async () => {
    const s = servidor();
    sessao.terminou = true;
    s.resposta = () => Promise.reject(new Error("401"));
    const { result } = montar(s, estrito);
    await andar(0);
    expect(result.current.estado).toEqual({
      tipo: "erro",
      titulo: "Sua sessão terminou.",
      texto: "Entre de novo para continuar.",
      semSessao: true,
    });
    await andar(30_000);
    expect(s.chamadas.length).toBe(1);
  });

  it("sem imagem ainda: pede o QR de novo em 3 s, sem contar rodada; na 10ª vira erro", async () => {
    const s = servidor();
    let semImagem = 2;
    s.resposta = (p) => {
      if (p === "qr" && semImagem-- > 0) return Promise.resolve(SEM_QR);
      if (p === "qr") return Promise.resolve({ ok: true, conectado: false, qr: "data:image/png;base64,ENFIM", passkey: false });
      return Promise.resolve(SEM_QR);
    };
    const { result } = montar(s, estrito);
    await andar(6_000);
    expect(s.de("qr")).toEqual([0, 3_000, 6_000]);
    expect(result.current.estado).toMatchObject({ tipo: "qr", rodada: 1, desde: s.inicio + 6_000 });
    // a rodada 1 vale 20 s a partir da imagem
    await andar(20_000);
    expect(s.de("qr")).toEqual([0, 3_000, 6_000, 26_000]);
  });

  it("10 pedidos seguidos sem imagem viram erro", async () => {
    const s = servidor();
    s.resposta = () => Promise.resolve(SEM_QR);
    const { result } = montar(s, estrito);
    await andar(3_000 * (TEMPOS_QR.maxSemImagem - 1) - 1);
    expect(result.current.estado).toEqual({ tipo: "carregando" });
    await andar(1);
    expect(s.de("qr").length).toBe(TEMPOS_QR.maxSemImagem);
    expect(result.current.estado).toEqual({
      tipo: "erro",
      titulo: "O QR code não chegou.",
      texto: "Tente de novo em instantes.",
      semSessao: false,
    });
    await andar(30_000);
    expect(s.chamadas.length).toBe(TEMPOS_QR.maxSemImagem);
  });

  it("passkey: só consulta a situação, a cada 3 s, e vence em 10 min", async () => {
    const s = servidor();
    s.resposta = (p) => Promise.resolve(p === "qr" ? { ok: true, conectado: false, qr: null, passkey: true } : SEM_QR);
    const { result } = montar(s, estrito);
    await andar(0);
    expect(result.current.estado).toEqual({ tipo: "passkey" });
    await andar(9_000);
    expect(s.de("situacao")).toEqual([3_000, 6_000, 9_000]);
    await andar(TEMPOS_QR.passkeyMs - 9_000 - 1);
    expect(result.current.estado).toEqual({ tipo: "passkey" });
    expect(s.de("qr")).toEqual([0]);
    expect(s.de("situacao").length).toBe(199);
    await andar(1);
    expect(result.current.estado).toEqual({ tipo: "expirado" });
    await andar(60_000);
    expect(s.de("situacao").length).toBe(199);
  });

  it("passkey que conecta: chama aoConectar", async () => {
    const s = servidor();
    s.resposta = (p, n) =>
      Promise.resolve(p === "qr" ? { ok: true, conectado: false, qr: null, passkey: true } : n >= 4 ? CONECTADO : SEM_QR);
    const { result, aoConectar } = montar(s, estrito);
    await andar(9_000);
    expect(result.current.estado).toEqual({ tipo: "conectado" });
    expect(aoConectar).toHaveBeenCalledTimes(1);
  });

  it("gerarOutro recomeça da rodada 1 (e a resposta velha é ignorada)", async () => {
    const s = servidor();
    const { result } = montar(s, estrito);
    await andar(60_000);
    expect(result.current.estado).toEqual({ tipo: "expirado" });

    act(() => result.current.gerarOutro());
    expect(result.current.estado).toEqual({ tipo: "carregando" });
    await andar(0);
    expect(result.current.estado).toMatchObject({ tipo: "qr", rodada: 1, desde: s.inicio + 60_000 });
    await andar(20_000);
    expect(result.current.estado).toMatchObject({ tipo: "qr", rodada: 2 });

    // gerarOutro com um pedido no ar: a resposta dele não muda a tela
    let soltarVelho: (r: RespostaQr) => void = () => {};
    s.resposta = (p) => (p === "situacao" ? new Promise<RespostaQr>((r) => (soltarVelho = r)) : Promise.resolve({ ok: true, conectado: false, qr: "data:image/png;base64,NOVO", passkey: false }));
    await andar(3_000);
    act(() => result.current.gerarOutro());
    await andar(0);
    expect(result.current.estado).toMatchObject({ tipo: "qr", rodada: 1, imagem: "data:image/png;base64,NOVO" });
    await act(async () => soltarVelho(CONECTADO));
    expect(result.current.estado).toMatchObject({ tipo: "qr", rodada: 1 });
  });

  it("desligar para tudo, ignora a resposta no ar e religar começa do zero", async () => {
    const s = servidor();
    const { result, rerender, aoConectar } = montar(s, estrito);
    await andar(6_000);
    let soltar: (r: RespostaQr) => void = () => {};
    s.resposta = () => new Promise<RespostaQr>((r) => (soltar = r));
    await andar(3_000);
    const total = s.chamadas.length;
    rerender({ ativo: false, aoConectar });
    await act(async () => soltar(CONECTADO));
    await andar(120_000);
    expect(s.chamadas.length).toBe(total);
    expect(aoConectar).not.toHaveBeenCalled();
    expect(result.current.estado.tipo).toBe("qr");

    s.resposta = null;
    rerender({ ativo: true, aoConectar });
    await andar(0);
    expect(s.chamadas.length).toBe(total + 1);
    expect(s.chamadas.at(-1)!.p).toBe("qr");
    expect(result.current.estado).toMatchObject({ tipo: "qr", rodada: 1 });
  });

  it("religar mostra 'carregando' já no primeiro desenho (nunca o estado da ligada anterior)", async () => {
    const s = servidor();
    const vistos: string[] = [];
    const aoConectar = vi.fn();
    const { result, rerender } = renderHook(
      (props: { ativo: boolean }) => {
        const leitura = useLeituraQr({ ...props, pedir: s.pedir, aoConectar });
        // o que cada desenho confirmado mostrou
        useEffect(() => {
          vistos.push(leitura.estado.tipo);
        });
        return leitura;
      },
      { initialProps: { ativo: true }, ...(estrito ? { wrapper: Estrito } : {}) },
    );
    await andar(0);
    expect(result.current.estado.tipo).toBe("qr");
    rerender({ ativo: false });
    expect(result.current.estado.tipo).toBe("qr");
    const antes = vistos.length;
    rerender({ ativo: true });
    expect(vistos.slice(antes)).toEqual(["carregando"]);
    expect(result.current.estado).toEqual({ tipo: "carregando" });
    await andar(0);
    expect(result.current.estado).toMatchObject({ tipo: "qr", rodada: 1 });
  });

  it("um aoConectar que desliga o hook na mesma hora não deixa temporizador nem pedido extra", async () => {
    const s = servidor();
    const conectou = vi.fn();
    const { result } = renderHook(
      () => {
        const [ativo, setAtivo] = useState(true);
        const leitura = useLeituraQr({
          ativo,
          pedir: s.pedir,
          aoConectar: () => {
            conectou();
            setAtivo(false);
          },
        });
        return { ativo, ...leitura };
      },
      estrito ? { wrapper: Estrito } : {},
    );
    await andar(6_000);
    s.conectado = true;
    await andar(3_000);
    expect(result.current.ativo).toBe(false);
    expect(result.current.estado).toEqual({ tipo: "conectado" });
    expect(conectou).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    const total = s.chamadas.length;
    await andar(120_000);
    expect(s.chamadas.length).toBe(total);
    expect(conectou).toHaveBeenCalledTimes(1);
  });

  it("QR vencido com a renovação sem imagem ou com falha passageira: 'carregando' até o QR novo", async () => {
    const s = servidor();
    let qrs = 0;
    s.resposta = (p) => {
      if (p === "situacao") return Promise.resolve(SEM_QR);
      qrs += 1;
      if (qrs === 2) return Promise.resolve(SEM_QR);
      if (qrs === 3) return Promise.resolve({ ok: false, erro: "tempo_esgotado" });
      return Promise.resolve({ ok: true, conectado: false, qr: `data:image/png;base64,R${qrs}`, passkey: false });
    };
    const { result } = montar(s, estrito);
    await andar(0);
    expect(result.current.estado).toMatchObject({ tipo: "qr", rodada: 1 });
    await andar(20_000);
    expect(s.de("qr")).toEqual([0, 20_000]);
    expect(result.current.estado).toEqual({ tipo: "carregando" });
    await andar(3_000);
    expect(result.current.estado).toEqual({ tipo: "carregando" });
    await andar(3_000);
    expect(s.de("qr")).toEqual([0, 20_000, 23_000, 26_000]);
    expect(result.current.estado).toEqual({ tipo: "qr", imagem: "data:image/png;base64,R4", rodada: 2, desde: s.inicio + 26_000 });
  });

  it("na renovação, o QR vencido sai da tela antes do pedido do novo: 'carregando' enquanto ele não volta", async () => {
    const s = servidor();
    let qrs = 0;
    let soltar: (r: RespostaQr) => void = () => {};
    s.resposta = (p) => {
      if (p === "situacao") return Promise.resolve(SEM_QR);
      qrs += 1;
      if (qrs === 2) return new Promise<RespostaQr>((r) => (soltar = r));
      return Promise.resolve({ ok: true, conectado: false, qr: `data:image/png;base64,P${qrs}`, passkey: false });
    };
    const { result } = montar(s, estrito);
    await andar(19_999);
    expect(result.current.estado).toMatchObject({ tipo: "qr", rodada: 1 });
    await andar(1);
    expect(s.de("qr")).toEqual([0, 20_000]);
    expect(result.current.estado).toEqual({ tipo: "carregando" });
    await act(async () => soltar({ ok: true, conectado: false, qr: "data:image/png;base64,NOVO", passkey: false }));
    expect(result.current.estado).toMatchObject({ tipo: "qr", rodada: 2, imagem: "data:image/png;base64,NOVO" });
  });

  it("QR vencido com a renovação rejeitada: 'carregando' até o QR novo", async () => {
    const s = servidor();
    let qrs = 0;
    s.resposta = (p) => {
      if (p === "situacao") return Promise.resolve(SEM_QR);
      qrs += 1;
      if (qrs === 2) return Promise.reject(new Error("rede"));
      if (qrs === 3) return Promise.resolve({ ok: false, erro: "falha" });
      return Promise.resolve({ ok: true, conectado: false, qr: `data:image/png;base64,R${qrs}`, passkey: false });
    };
    const { result } = montar(s, estrito);
    await andar(20_000);
    expect(result.current.estado).toEqual({ tipo: "carregando" });
    await andar(3_000);
    expect(result.current.estado).toEqual({ tipo: "carregando" });
    await andar(3_000);
    expect(result.current.estado).toMatchObject({ tipo: "qr", rodada: 2, imagem: "data:image/png;base64,R4" });
  });

  it("imagem inválida conta como sem imagem (pede de novo; na 10ª vira erro)", async () => {
    const s = servidor();
    let ruins = 2;
    s.resposta = (p) => {
      if (p === "qr" && ruins-- > 0)
        return Promise.resolve({ ok: true, conectado: false, qr: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", passkey: false });
      if (p === "qr") return Promise.resolve({ ok: true, conectado: false, qr: "data:image/png;base64,BOA", passkey: false });
      return Promise.resolve(SEM_QR);
    };
    const { result } = montar(s, estrito);
    await andar(3_000);
    expect(result.current.estado).toEqual({ tipo: "carregando" });
    await andar(3_000);
    expect(s.de("qr")).toEqual([0, 3_000, 6_000]);
    expect(result.current.estado).toMatchObject({ tipo: "qr", rodada: 1, imagem: "data:image/png;base64,BOA" });

    const t = servidor();
    t.resposta = () => Promise.resolve({ ok: true, conectado: false, qr: "https://exemplo.com/qr.png", passkey: false });
    const outro = montar(t, estrito);
    await andar(3_000 * (TEMPOS_QR.maxSemImagem - 1));
    expect(t.de("qr").length).toBe(TEMPOS_QR.maxSemImagem);
    expect(outro.result.current.estado).toMatchObject({ tipo: "erro", titulo: "O QR code não chegou." });
  });

  it("'falha' (a rejeição traduzida): 2 seguidas e depois um sucesso não dão erro", async () => {
    const s = servidor();
    s.resposta = (p, n) =>
      Promise.resolve(n <= 2 ? { ok: false, erro: "falha" } : { ok: true, conectado: false, qr: "data:image/png;base64,OK", passkey: false });
    const { result } = montar(s, estrito);
    await andar(3_000);
    expect(result.current.estado).toEqual({ tipo: "carregando" });
    await andar(3_000);
    expect(s.de("qr")).toEqual([0, 3_000, 6_000]);
    expect(result.current.estado).toMatchObject({ tipo: "qr", rodada: 1 });
  });

  it("'falha' 3 vezes seguidas vira o erro de rede", async () => {
    const s = servidor();
    s.resposta = () => Promise.resolve({ ok: false, erro: "falha" });
    const { result } = montar(s, estrito);
    await andar(6_000);
    expect(s.de("qr")).toEqual([0, 3_000, 6_000]);
    expect(result.current.estado).toEqual({
      tipo: "erro",
      titulo: "Não conseguimos fazer o teste agora.",
      texto: "Confira a sua internet e tente de novo em instantes.",
      semSessao: false,
    });
    await andar(30_000);
    expect(s.chamadas.length).toBe(3);
  });

  it("'falha' com a sessão encerrada vira erro semSessao na hora", async () => {
    const s = servidor();
    sessao.terminou = true;
    s.resposta = () => Promise.resolve({ ok: false, erro: "falha" });
    const { result } = montar(s, estrito);
    await andar(0);
    expect(result.current.estado).toEqual({
      tipo: "erro",
      titulo: "Sua sessão terminou.",
      texto: "Entre de novo para continuar.",
      semSessao: true,
    });
    await andar(30_000);
    expect(s.chamadas.length).toBe(1);
  });

  it.each([
    ["sem_conexao", "Não há um WhatsApp conectado para mostrar o QR code.", "Conecte um número de novo."],
    ["nao_e_qr", "Este WhatsApp não conecta por QR code.", ""],
    ["cifra_indisponivel", "Não conseguimos ler os dados guardados desta conexão.", "Cole os dados de novo."],
    ["cifra_invalida", "Não conseguimos ler os dados guardados desta conexão.", "Cole os dados de novo."],
    ["erro_ao_ler", "Não conseguimos ler os dados guardados desta conexão.", "Cole os dados de novo."],
  ])("mensagem própria do passo: %s", async (erro, titulo, texto) => {
    const s = servidor();
    s.resposta = () => Promise.resolve({ ok: false, erro });
    const { result } = montar(s, estrito);
    await andar(0);
    expect(result.current.estado).toEqual({ tipo: "erro", titulo, texto, semSessao: false });
    await andar(30_000);
    expect(s.chamadas.length).toBe(1);
  });

  it("desligado desde o começo, não pede nada", async () => {
    const s = servidor();
    const { result } = montar(s, estrito, false);
    await andar(60_000);
    expect(s.chamadas.length).toBe(0);
    expect(result.current.estado).toEqual({ tipo: "carregando" });
  });

  it("desmontar para tudo, e a resposta que chega depois não faz nada", async () => {
    const s = servidor();
    let soltar: (r: RespostaQr) => void = () => {};
    const { unmount, aoConectar } = montar(s, estrito);
    await andar(0);
    s.resposta = () => new Promise<RespostaQr>((r) => (soltar = r));
    await andar(3_000);
    const total = s.chamadas.length;
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => soltar(CONECTADO));
    await andar(120_000);
    expect(s.chamadas.length).toBe(total);
    expect(aoConectar).not.toHaveBeenCalled();
  });
});

/* ---------- PassoQr ---------- */

const IMG = "data:image/png;base64,AAAA";

function desenhar(estado: EstadoLeituraQr, extra: Partial<Parameters<typeof PassoQr>[0]> = {}) {
  const aoGerarOutro = vi.fn();
  const aoEntrarDeNovo = vi.fn();
  const props = {
    estado,
    gateway: "zapi" as const,
    variante: "palco" as const,
    idTitulo: "qr-titulo",
    aoGerarOutro,
    aoEntrarDeNovo,
    acoes: <button type="button">Corrigir os dados</button>,
    ...extra,
  };
  const r = render(<PassoQr {...props} />);
  return { ...r, aoGerarOutro, aoEntrarDeNovo, props };
}

function viva(container: HTMLElement) {
  const el = container.querySelector('[aria-live="polite"]');
  expect(el).not.toBeNull();
  return el!;
}

const INSTRUCOES = [
  "Abra o WhatsApp no celular do número que a Janete vai usar.",
  "Toque em ⋮ (Android) ou em Configurações (iPhone) e depois em Dispositivos conectados.",
  "Toque em Conectar dispositivo e aponte a câmera para o QR code.",
];

describe("PassoQr", () => {
  it("qr: título (h2, foco programático), 'Falta 1 passo', a imagem, as instruções, a linha viva, a frase do celular e as ações", () => {
    const { container } = desenhar({ tipo: "qr", imagem: IMG, rodada: 1, desde: 0 });
    const titulo = screen.getByRole("heading", { level: 2, name: "Leia o QR code com o WhatsApp do celular" });
    expect(titulo).toHaveAttribute("id", "qr-titulo");
    expect(titulo).toHaveAttribute("tabindex", "-1");
    expect(screen.getByText("Falta 1 passo")).toBeInTheDocument();
    const img = screen.getByRole("img", { name: "QR code para conectar o WhatsApp" });
    expect(img).toHaveAttribute("src", IMG);
    expect(img).toHaveAttribute("width", "232");
    expect(img).toHaveAttribute("height", "232");
    const itens = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(itens).toEqual(INSTRUCOES);
    expect(viva(container)).toHaveTextContent("Esperando a leitura. O QR code muda a cada 20 segundos.");
    expect(screen.getByText("Se o número é deste celular, abra esta tela no computador para ler o QR code.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Corrigir os dados" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gerar outro QR code" })).toBeNull();
  });

  it("carregando: o quadro vazio, 'Gerando o QR code…' e as instruções", () => {
    const { container } = desenhar({ tipo: "carregando" });
    expect(screen.queryByRole("img")).toBeNull();
    expect(viva(container)).toHaveTextContent("Gerando o QR code…");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("heading", { name: "Leia o QR code com o WhatsApp do celular" })).toBeInTheDocument();
  });

  it("expirado: a última imagem apagada, 'O QR code expirou.' e 'Gerar outro QR code'", () => {
    const { container, rerender, props, aoGerarOutro } = desenhar({ tipo: "qr", imagem: IMG, rodada: 3, desde: 0 });
    rerender(<PassoQr {...props} estado={{ tipo: "expirado" }} />);
    const img = screen.getByRole("img", { name: "QR code para conectar o WhatsApp" });
    expect(img).toHaveAttribute("src", IMG);
    expect(img.className).toMatch(/apagada/);
    expect(viva(container)).toHaveTextContent("O QR code expirou.");
    fireEvent.click(screen.getByRole("button", { name: "Gerar outro QR code" }));
    expect(aoGerarOutro).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Corrigir os dados" })).toBeInTheDocument();
  });

  it("a imagem guardada zera no 'carregando': o expirado seguinte não mostra o QR velho", () => {
    const { container, rerender, props } = desenhar({ tipo: "qr", imagem: IMG, rodada: 3, desde: 0 });
    rerender(<PassoQr {...props} estado={{ tipo: "carregando" }} />);
    expect(screen.queryByRole("img")).toBeNull();
    rerender(<PassoQr {...props} estado={{ tipo: "expirado" }} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(viva(container)).toHaveTextContent("O QR code expirou.");
    expect(screen.getByRole("button", { name: "Gerar outro QR code" })).toBeInTheDocument();
  });

  it("passkey: o título e o texto da chave de acesso, sem QR", () => {
    const { container } = desenhar({ tipo: "passkey" });
    expect(screen.getByRole("heading", { level: 2, name: "O WhatsApp pediu a chave de acesso" })).toHaveAttribute("id", "qr-titulo");
    expect(viva(container)).toHaveTextContent(
      "Este celular pede uma confirmação extra (passkey), que só a Z-API consegue concluir. Termine a conexão pelo painel da Z-API, com a extensão Z-API Connector. Esta tela segue sozinha quando o número conectar.",
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("button", { name: "Corrigir os dados" })).toBeInTheDocument();
  });

  it("conectado: 'Celular conectado. Salvando a conexão…'", () => {
    const { container } = desenhar({ tipo: "conectado" });
    expect(viva(container)).toHaveTextContent("Celular conectado. Salvando a conexão…");
  });

  it("erro: título, texto e 'Tentar de novo' (aoGerarOutro)", () => {
    const { container, aoGerarOutro } = desenhar({
      tipo: "erro",
      titulo: "A Z-API não aceitou os tokens.",
      texto: "Confira o Client-Token.",
      semSessao: false,
    });
    expect(screen.getByRole("heading", { level: 2, name: "A Z-API não aceitou os tokens." })).toHaveAttribute("id", "qr-titulo");
    // a linha viva anuncia título e texto juntos
    expect(viva(container).textContent).toBe("A Z-API não aceitou os tokens. Confira o Client-Token.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(aoGerarOutro).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Entrar de novo" })).toBeNull();
    expect(screen.getByRole("button", { name: "Corrigir os dados" })).toBeInTheDocument();
  });

  it("erro de uma frase só: a linha viva não fica muda (anuncia o título)", () => {
    const { container } = desenhar({ tipo: "erro", titulo: "Este WhatsApp não conecta por QR code.", texto: "", semSessao: false });
    expect(viva(container).textContent).toBe("Este WhatsApp não conecta por QR code.");
  });

  it.each([
    ["Gerar outro QR code", { tipo: "expirado" } as EstadoLeituraQr],
    ["Tentar de novo", { tipo: "erro", titulo: "O QR code não chegou.", texto: "Tente de novo em instantes.", semSessao: false } as EstadoLeituraQr],
  ])("'%s' some no clique: o foco volta ao título", (botao, estado) => {
    const { props, rerender, aoGerarOutro } = desenhar(estado);
    // o hook troca o estado para "carregando" no clique, e o botão some
    aoGerarOutro.mockImplementation(() => rerender(<PassoQr {...props} estado={{ tipo: "carregando" }} />));
    const b = screen.getByRole("button", { name: botao });
    b.focus();
    fireEvent.click(b);
    expect(screen.queryByRole("button", { name: botao })).toBeNull();
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Leia o QR code com o WhatsApp do celular" }));
  });

  it("erro sem sessão: o botão vira 'Entrar de novo' (aoEntrarDeNovo)", () => {
    const { aoEntrarDeNovo, aoGerarOutro } = desenhar({
      tipo: "erro",
      titulo: "Sua sessão terminou.",
      texto: "Entre de novo para continuar.",
      semSessao: true,
    });
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Entrar de novo" }));
    expect(aoEntrarDeNovo).toHaveBeenCalledTimes(1);
    expect(aoGerarOutro).not.toHaveBeenCalled();
  });

  it("variante cartão: h3, sem a linha 'Falta 1 passo'", () => {
    desenhar({ tipo: "qr", imagem: IMG, rodada: 1, desde: 0 }, { variante: "cartao", idTitulo: "cfg-qr-titulo" });
    const titulo = screen.getByRole("heading", { level: 3, name: "Leia o QR code com o WhatsApp do celular" });
    expect(titulo).toHaveAttribute("id", "cfg-qr-titulo");
    expect(titulo).toHaveAttribute("tabindex", "-1");
    expect(screen.queryByText("Falta 1 passo")).toBeNull();
    expect(screen.getByRole("img", { name: "QR code para conectar o WhatsApp" })).toBeInTheDocument();
  });

  it("nivel muda o título (h3 no palco), e a raiz leva o id `${idTitulo}-passo`", () => {
    const { container } = desenhar({ tipo: "qr", imagem: IMG, rodada: 1, desde: 0 }, { nivel: 3 });
    expect(screen.getByRole("heading", { level: 3, name: "Leia o QR code com o WhatsApp do celular" })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("id", "qr-titulo-passo");
  });

  it("o brilho do quadro vazio só no 'carregando' (no expirado sem imagem, parado)", () => {
    const { container, rerender, props } = desenhar({ tipo: "carregando" });
    expect(container.querySelector("[data-carregando]")).not.toBeNull();
    rerender(<PassoQr {...props} estado={{ tipo: "expirado" }} />);
    expect(container.querySelector("[data-vazio]")).not.toBeNull();
    expect(container.querySelector("[data-carregando]")).toBeNull();
  });

  it("os textos exportados são os da spec", () => {
    expect(TEXTOS_QR.passos).toEqual(INSTRUCOES);
    expect(TEXTOS_QR.esperando).toBe("Esperando a leitura. O QR code muda a cada 20 segundos.");
  });
});
