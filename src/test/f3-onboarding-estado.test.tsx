import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CAMPOS_CONTEXTO,
  CHAVE_SESSION_STORAGE,
  ETAPAS,
  limparEstadoOnboarding,
  lerEstadoOnboarding,
  onboardingConcluido,
  sanearEstado,
  useOnboarding,
} from "@/features/onboarding/estado";

const gravado = () => window.sessionStorage.getItem(CHAVE_SESSION_STORAGE) ?? "";

beforeEach(() => limparEstadoOnboarding());
afterEach(() => window.sessionStorage.clear());

describe("useOnboarding: etapas", () => {
  it("começa na conexão, avança até o preparo e volta, sem passar das pontas", () => {
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.etapa).toBe("conexao");
    expect(result.current.primeira).toBe(true);

    act(() => result.current.voltar());
    expect(result.current.etapa).toBe("conexao");

    const vistas: string[] = [result.current.etapa];
    for (let i = 0; i < ETAPAS.length + 1; i++) {
      act(() => result.current.avancar());
      vistas.push(result.current.etapa);
    }
    expect(vistas).toEqual([
      "conexao",
      "cerebro",
      "despertar",
      "voz",
      "conversa",
      "preparando",
      "preparando",
      "preparando",
    ]);
    expect(result.current.ultima).toBe(true);

    act(() => result.current.voltar());
    expect(result.current.etapa).toBe("conversa");
    act(() => result.current.irPara("cerebro"));
    expect(result.current.etapa).toBe("cerebro");
    expect(result.current.indice).toBe(1);
  });

  it("dois componentes que usam o hook veem o mesmo estado", () => {
    const a = renderHook(() => useOnboarding());
    const b = renderHook(() => useOnboarding());

    act(() => a.result.current.avancar());
    expect(b.result.current.etapa).toBe("cerebro");
  });

  it("concluir marca o onboarding como concluído e recomeçar volta ao início", () => {
    const { result } = renderHook(() => useOnboarding());
    act(() => result.current.irPara("preparando"));
    act(() => result.current.concluir());

    expect(onboardingConcluido()).toBe(true);
    expect(Number.isNaN(Date.parse(result.current.estado.concluidoEm ?? ""))).toBe(false);

    act(() => result.current.recomecar());
    expect(onboardingConcluido()).toBe(false);
    expect(result.current.etapa).toBe("conexao");
    expect(window.sessionStorage.getItem(CHAVE_SESSION_STORAGE)).toBeNull();
  });
});

describe("useOnboarding: o que fica no sessionStorage, por etapa", () => {
  it("guarda a etapa, as escolhas de cada etapa, as respostas e o ultimos4, e os lê de volta", () => {
    const { result, unmount } = renderHook(() => useOnboarding());
    act(() => {
      result.current.definirConexao({ modo: "naooficial", gateway: "zapi", rotulo: "+55 11 99999-0000" });
      result.current.definirCerebro({ provedor: "anthropic", modelo: "claude-sonnet-4-5", ultimos4: "a1b2" });
      result.current.definirVoz({ ultimos4: "c3d4" });
      result.current.responder("empresa_oferta", "Consultoria de vendas");
      result.current.responder("horario", "Seg a sex, 9h às 18h");
      result.current.confirmarContexto();
      result.current.irPara("conversa");
    });
    unmount();

    expect(JSON.parse(gravado())).toEqual({
      etapa: "conversa",
      conexao: { modo: "naooficial", gateway: "zapi", rotulo: "+55 11 99999-0000" },
      cerebro: { provedor: "anthropic", modelo: "claude-sonnet-4-5", ultimos4: "a1b2" },
      voz: { ultimos4: "c3d4", pulou: false },
      conversa: {
        respostas: { empresa_oferta: "Consultoria de vendas", horario: "Seg a sex, 9h às 18h" },
        confirmado: true,
      },
      concluidoEm: null,
    });

    // Como se a página recarregasse: um hook novo lê o que ficou gravado na aba.
    const recarregado = renderHook(() => useOnboarding());
    expect(recarregado.result.current.etapa).toBe("conversa");
    expect(recarregado.result.current.estado.cerebro.ultimos4).toBe("a1b2");
    expect(recarregado.result.current.estado.voz).toEqual({ ultimos4: "c3d4", pulou: false });
  });

  it("definir uma escolha não apaga as outras da mesma etapa", () => {
    const { result } = renderHook(() => useOnboarding());
    act(() => result.current.definirCerebro({ provedor: "openai", modelo: "gpt-5" }));
    act(() => result.current.definirCerebro({ ultimos4: "wxyz" }));

    expect(result.current.estado.cerebro).toEqual({ provedor: "openai", modelo: "gpt-5", ultimos4: "wxyz" });
  });

  it("definirVoz: o 'Fazer depois' grava o pulou, a chave aceita grava o ultimos4, e um não apaga o outro", () => {
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.estado.voz).toEqual({ ultimos4: null, pulou: false });

    act(() => result.current.definirVoz({ pulou: true }));
    expect(result.current.estado.voz).toEqual({ ultimos4: null, pulou: true });
    expect(JSON.parse(gravado()).voz).toEqual({ ultimos4: null, pulou: true });

    act(() => result.current.definirVoz({ ultimos4: "wxyz" }));
    expect(result.current.estado.voz).toEqual({ ultimos4: "wxyz", pulou: true });

    act(() => result.current.definirVoz({ ultimos4: null, pulou: false }));
    expect(result.current.estado.voz).toEqual({ ultimos4: null, pulou: false });
    // a voz não mexe nas outras etapas
    expect(result.current.estado.cerebro).toEqual({ provedor: null, modelo: null, ultimos4: null });
  });

  it("definirRespostas troca o painel inteiro e ignora campos que não são do Contexto", () => {
    const { result } = renderHook(() => useOnboarding());
    act(() => result.current.responder("preco", "R$ 100"));
    act(() =>
      result.current.definirRespostas({ tom_voz: "Leve", campo_inventado: "x" } as unknown as Record<string, string>),
    );

    expect(result.current.estado.conversa.respostas).toEqual({ tom_voz: "Leve" });
  });

  it("aceita os 8 campos do Contexto", () => {
    const { result } = renderHook(() => useOnboarding());
    act(() => {
      for (const campo of CAMPOS_CONTEXTO) result.current.responder(campo, `resposta de ${campo}`);
    });

    expect(Object.keys(result.current.estado.conversa.respostas).sort()).toEqual([...CAMPOS_CONTEXTO].sort());
  });

  it("se o sessionStorage recusar a gravação, o estado continua valendo em memória e nada é gravado", () => {
    const recusar = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("cota cheia", "QuotaExceededError");
    });
    try {
      const { result } = renderHook(() => useOnboarding());
      act(() => result.current.avancar());
      expect(recusar).toHaveBeenCalled();
      expect(result.current.etapa).toBe("cerebro");
      act(() => result.current.avancar());
      expect(result.current.etapa).toBe("despertar");
      expect(lerEstadoOnboarding().etapa).toBe("despertar");
      expect(window.sessionStorage.getItem(CHAVE_SESSION_STORAGE)).toBeNull();
    } finally {
      recusar.mockRestore();
    }
  });

  it("a resposta é cortada em 2.000 letras como o banco conta: o emoji vale 1 e nunca é partido ao meio", () => {
    const campo = CAMPOS_CONTEXTO[0]!;
    // 1.999 letras e um emoji (2 unidades no .length): cabe inteiro, porque o banco conta 2.000
    const cabe = "a".repeat(1999) + "😀";
    expect(sanearEstado({ conversa: { respostas: { [campo]: cabe } } }).conversa.respostas[campo]).toBe(cabe);
    // 2.000 letras e mais um emoji: o corte tira o emoji inteiro, sem deixar meia letra
    const passa = "a".repeat(1999) + "😀" + "😀";
    const cortada = sanearEstado({ conversa: { respostas: { [campo]: passa } } }).conversa.respostas[campo]!;
    expect(cortada).toBe(cabe);
    expect(/[\uD800-\uDBFF]$/.test(cortada)).toBe(false);
  });

  it("um valor corrompido ou de outra versão vira o estado inicial, sem quebrar", () => {
    window.sessionStorage.setItem(CHAVE_SESSION_STORAGE, "{não é json");
    expect(lerEstadoOnboarding().etapa).toBe("conexao");

    window.sessionStorage.setItem(CHAVE_SESSION_STORAGE, JSON.stringify({ etapa: "plataforma", conexao: 3 }));
    expect(lerEstadoOnboarding()).toEqual(sanearEstado({}));
  });
});

describe("useOnboarding: nenhum segredo vai para o sessionStorage", () => {
  const CHAVE_IA = "sk-ant-api03-SEGREDO-CHAVE-IA-0000000000wxyz";
  const TOKEN_GATEWAY = "EAAGSEGREDOTOKENDAMETA123";
  const TOKEN_ZAPI = "SEGREDO-TOKEN-ZAPI";

  it("campos a mais (chave, token, campos do formulário) são descartados ao gravar", () => {
    const { result } = renderHook(() => useOnboarding());
    act(() => {
      result.current.definirConexao({
        gateway: "zapi",
        rotulo: "minha-instancia",
        campos: { instanceId: "abc", token: TOKEN_ZAPI },
        token: TOKEN_ZAPI,
      } as never);
      result.current.definirCerebro({
        provedor: "anthropic",
        modelo: "claude-sonnet-4-5",
        ultimos4: "wxyz",
        chave: CHAVE_IA,
      } as never);
    });

    const texto = gravado();
    expect(texto).not.toContain("SEGREDO");
    expect(texto).not.toContain("chave");
    expect(texto).not.toContain("token");
    expect(texto).not.toContain("campos");
    expect(result.current.estado.conexao).toEqual({ modo: null, gateway: "zapi", rotulo: "minha-instancia" });
  });

  it("se a chave inteira chegar no ultimos4, só os 4 últimos caracteres ficam", () => {
    const { result } = renderHook(() => useOnboarding());
    act(() => result.current.definirCerebro({ provedor: "anthropic", ultimos4: CHAVE_IA }));

    expect(result.current.estado.cerebro.ultimos4).toBe("wxyz");
    expect(gravado()).not.toContain("SEGREDO");
  });

  it("a chave inteira da ElevenLabs no definirVoz: só os 4 últimos caracteres ficam", () => {
    const { result } = renderHook(() => useOnboarding());
    act(() => result.current.definirVoz({ ultimos4: "sk_teste_SEGREDO_1234567890abcd" }));

    expect(result.current.estado.voz.ultimos4).toBe("abcd");
    expect(gravado()).not.toContain("SEGREDO");
  });

  it("sanearEstado na voz: corta o ultimos4 em 4 caracteres e descarta um pulou que não seja true", () => {
    expect(sanearEstado({ voz: { ultimos4: "  sk_teste_1234567890abcd  ", pulou: true } }).voz).toEqual({
      ultimos4: "abcd",
      pulou: true,
    });
    for (const pulou of ["true", 1, "sim", {}, null, undefined]) {
      expect(sanearEstado({ voz: { ultimos4: "abcd", pulou } }).voz.pulou).toBe(false);
    }
    // o que não é texto, ou é só espaço, vira null; campos a mais somem
    expect(sanearEstado({ voz: { ultimos4: 1234, chave: "sk_teste_SEGREDO_1234567890abcd" } }).voz).toEqual({
      ultimos4: null,
      pulou: false,
    });
    expect(sanearEstado({ voz: { ultimos4: "   " } }).voz.ultimos4).toBeNull();
    expect(sanearEstado({ voz: "abcd" }).voz).toEqual({ ultimos4: null, pulou: false });
    expect(JSON.stringify(sanearEstado({ voz: { chave: "sk_teste_SEGREDO_1234567890abcd" } }))).not.toContain("SEGREDO");
  });

  it("um texto com cara de chave no modelo ou no rótulo é descartado", () => {
    const { result } = renderHook(() => useOnboarding());
    act(() => {
      result.current.definirCerebro({ modelo: CHAVE_IA });
      result.current.definirConexao({ rotulo: TOKEN_GATEWAY });
    });

    expect(result.current.estado.cerebro.modelo).toBeNull();
    expect(result.current.estado.conexao.rotulo).toBeNull();
    expect(gravado()).not.toContain("SEGREDO");
  });

  it("um segredo que já estava no sessionStorage some na leitura e na próxima gravação", () => {
    window.sessionStorage.setItem(
      CHAVE_SESSION_STORAGE,
      JSON.stringify({
        etapa: "cerebro",
        chave: CHAVE_IA,
        conexao: { gateway: "meta", rotulo: "+55 11 90000-0000", token: TOKEN_GATEWAY },
        cerebro: { provedor: "openai", chave: CHAVE_IA, ultimos4: "wxyz" },
      }),
    );

    const { result } = renderHook(() => useOnboarding());
    expect(JSON.stringify(result.current.estado)).not.toContain("SEGREDO");

    act(() => result.current.avancar());
    expect(gravado()).not.toContain("SEGREDO");
    expect(result.current.estado.cerebro).toEqual({ provedor: "openai", modelo: null, ultimos4: "wxyz" });
  });
});
