import { QueryClientContext } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";

import { useVooJanete } from "@/components/janete/VooJanete";
import BrandLogo from "@/components/brand/BrandLogo";
import { ASSISTANT_NAME } from "@/lib/brand";
import { Aviso, Botao } from "@/components/aipro";
import { type Classes } from "@/components/aipro/cx";
import {
  escolherVoz,
  listarVozes,
  salvarChaveIA,
  salvarConexao,
  usarChaveElevenLabs,
} from "@/features/mensageria/configuracao.functions";
import { desconectarCelular, pedirQrConexao } from "@/features/mensageria/qr.functions";
import { Carregando, ErroLeitura } from "@/features/plataforma/dados/estados";
import { servidorDaPlataforma } from "@/features/plataforma/dados/servidor.functions";
import {
  ProvedorDadosOnboarding,
  useDadosOnboarding,
  useDadosOnboardingBanco,
  type DadosOnboarding,
  type ServidorOnboarding,
} from "@/features/plataforma/dados/onboarding";
import type { Erro } from "@/features/plataforma/dados/tipos";
import { firebase } from "@/integrations/firebase/client";

import { EtapaCerebro } from "./cerebro";
import { EtapaConexao } from "./conexao";
import { EtapaConversa } from "./conversa";
import { EtapaDespertar } from "./despertar";
import {
  ETAPAS,
  gravarEstadoOnboarding,
  juntarComGravado,
  lerEstadoOnboarding,
  temEstadoNaAba,
  useOnboarding,
  type Etapa,
} from "./estado";
import { PalcoContexto, type Palco } from "./palco";
import { EtapaPreparando } from "./preparando";
import { EtapaVoz } from "./voz";
import estilos from "./Onboarding.module.css";

const s = estilos as Classes<
  | "app"
  | "sr"
  | "nav"
  | "marca"
  | "janete"
  | "janeteSvg"
  | "nsDisco"
  | "nsPonto"
  | "janeteTxt"
  | "janeteEstado"
  | "passos"
  | "passosLista"
  | "passo"
  | "num"
  | "n"
  | "check"
  | "rotulo"
  | "acao"
  | "sair"
  | "sairTxt"
  | "palco"
  | "espera"
  | "falhaConcluir"
>;

// O orquestrador: a barra de cima do F, a região de anúncio e o palco com a etapa atual, que
// recebe avancar() e voltar(). O estado é o mesmo em toda a aba: uma etapa pode chamar useOnboarding()
// para ler e gravar as escolhas.
//
// Regras para as etapas (C2 a C5):
// - Cada etapa tem um único <h1> com o título dela. Ao trocar de etapa, o orquestrador leva o foco
//   para esse <h1> (quem usa teclado ou leitor de tela não perde a posição e ouve a etapa nova).
// - definirConexao({ rotulo }) só recebe o `nome` que veio de salvarConexao. Nunca o que a
//   pessoa digitou: o filtro do estado não reconhece tokens sem prefixo (Z-API, Evolution).
// - Com a Janete no palco (validação, despertar), a etapa chama useJaneteNoPalco(true): a marca sai
//   da barra (uma marca só). Para o leitor de tela, usePalco().anunciar(texto).
// - Na validação (o cartão dobrando e o logo girando), a etapa chama useBarraRecolhida(true).
// - A altura da barra fica em --onb-nav-h (4.5rem; 7.25rem abaixo de 900 px).

export interface PropsEtapa {
  avancar: () => void;
  voltar: () => void;
}

/** Rótulos da barra de etapas, como no F. */
export const ROTULO_DA_ETAPA: Record<Etapa, string> = {
  conexao: "WhatsApp",
  cerebro: "Cérebro",
  despertar: ASSISTANT_NAME,
  voz: "Voz",
  conversa: "Conversa",
  preparando: "Preparo",
};

/** A trilha do F: as 6 etapas e a plataforma, que é o destino e nunca fica atual aqui. */
const TRILHA: readonly { id: Etapa | "plataforma"; rotulo: string }[] = [
  ...ETAPAS.map((e) => ({ id: e, rotulo: ROTULO_DA_ETAPA[e] })),
  { id: "plataforma", rotulo: "Plataforma" },
];

/** As etapas com a marca "Janete" na barra (P7 da spec da voz): as que não têm a Janete no palco. */
const ETAPAS_COM_MARCA: readonly Etapa[] = ["conexao", "cerebro", "voz"];

const COMPONENTE_DA_ETAPA: Record<Etapa, ComponentType<PropsEtapa>> = {
  conexao: EtapaConexao,
  cerebro: EtapaCerebro,
  despertar: EtapaDespertar,
  voz: EtapaVoz,
  conversa: EtapaConversa,
  preparando: EtapaPreparando,
};

export interface PropsOnboarding {
  /** Chamado quando a última etapa avança: o onboarding já foi gravado como concluído no banco. */
  aoConcluir: () => void;
  /** Os dados do onboarding (os testes passam o modo sem banco). Sem ele, o modo banco. */
  dados?: DadosOnboarding;
}

/** As funções de servidor de verdade (só admin; a lógica fica no servidor). */
const SERVIDOR: ServidorOnboarding = {
  salvarConexao: (data) => salvarConexao({ data }),
  salvarChaveIA: (data) => salvarChaveIA({ data }),
  pedirQr: (data) => pedirQrConexao({ data }),
  listarVozes: () => listarVozes({ data: {} }),
  escolherVoz: (data) => escolherVoz({ data }),
  desconectarCelular: (data) => desconectarCelular({ data }),
  usarChaveElevenLabs: (data) => usarChaveElevenLabs({ data }),
  // o mesmo toque do ServidorDados da plataforma (spec-motor-acordado), depois de concluir
  acordarMotor: () => servidorDaPlataforma.acordarMotor?.() ?? Promise.resolve(),
};

export function Onboarding({ aoConcluir, dados }: PropsOnboarding) {
  if (dados) {
    return (
      <ProvedorDadosOnboarding dados={dados}>
        <OnboardingComDados aoConcluir={aoConcluir} />
      </ProvedorDadosOnboarding>
    );
  }
  return <OnboardingBanco aoConcluir={aoConcluir} />;
}

function OnboardingBanco({ aoConcluir }: PropsOnboarding) {
  const dados = useDadosOnboardingBanco(firebase, SERVIDOR);
  return (
    <ProvedorDadosOnboarding dados={dados}>
      <OnboardingComDados aoConcluir={aoConcluir} />
    </ProvedorDadosOnboarding>
  );
}

/** O texto da falha ao concluir (concluir_onboarding). */
export function textoErroConcluir(erro: Erro): string {
  if (erro === "sem_acesso") return "Sua conta não pode concluir o onboarding. Só o admin da empresa faz esta etapa.";
  return "Não conseguimos concluir agora. Confira a sua internet e tente de novo.";
}

/**
 * Espera o que já foi gravado no banco (a conexão, a chave e o Contexto) e junta com a aba antes de
 * mostrar a primeira etapa (decisão 14d): as etapas leem o estado inicial só na montagem.
 */
function OnboardingComDados({ aoConcluir }: PropsOnboarding) {
  const { gravado } = useDadosOnboarding();
  const [pronto, setPronto] = useState(false);
  const dadosGravados = gravado.dados;

  useLayoutEffect(() => {
    if (pronto || !dadosGravados) return;
    gravarEstadoOnboarding(juntarComGravado(lerEstadoOnboarding(), temEstadoNaAba(), dadosGravados));
    setPronto(true);
  }, [pronto, dadosGravados]);

  if (pronto) return <OnboardingCasca aoConcluir={aoConcluir} />;
  return (
    <EsperaOnboarding>
      {gravado.erro ? (
        <ErroLeitura erro={gravado.erro} titulo="Não deu para abrir o onboarding" tentarDeNovo={gravado.tentarDeNovo} />
      ) : (
        <Carregando forma="cartao" quantos={1} rotulo="Abrindo o onboarding" />
      )}
    </EsperaOnboarding>
  );
}

/** A espera antes da primeira etapa: o fundo da casca, com o estado no meio. */
function EsperaOnboarding({ children }: { children: ReactNode }) {
  return (
    <div data-identidade="aipro" className={s.app}>
      <main className={s.palco}>
        <div className={s.espera}>{children}</div>
      </main>
    </div>
  );
}

function OnboardingCasca({ aoConcluir }: Pick<PropsOnboarding, "aoConcluir">) {
  const { etapa, indice, ultima, avancar, voltar, concluir, irPara, recomecar } = useOnboarding();
  const dados = useDadosOnboarding();
  const [concluindo, setConcluindo] = useState(false);
  const [erroConcluir, setErroConcluir] = useState<string | null>(null);
  const EtapaAtual = COMPONENTE_DA_ETAPA[etapa];
  const principal = useRef<HTMLElement>(null);
  const etapaAnterior = useRef(etapa);
  const voo = useVooJanete();
  // Sem roteador (a casca renderizada sozinha num teste), o "Sair" cai na navegação comum.
  const router = useRouter({ warn: false }) as ReturnType<typeof useRouter> | undefined;

  // A casca montou com o símbolo em trânsito: veio do login (E6), e a etapa conexão cuida da chegada.
  const [veioDoLogin] = useState(() => voo.ativo);
  const [janeteNoPalco, setJaneteNoPalco] = useState(false);
  const [barraRecolhida, setBarraRecolhida] = useState(false);
  const [anuncio, setAnuncio] = useState(() => (voo.ativo ? "Conta criada. Preparando o seu espaço…" : ""));
  const [saindo, setSaindo] = useState(false);
  // Ligado pelo "Sair": o estado da aba é limpo quando a casca desmonta, já em /entrar.
  const limparAoDesmontar = useRef(false);

  // O cache do React Query (a conexão ativa, as chaves com o provedor e os últimos 4, o Contexto)
  // também sai com a conta, como no Sair da casca (spec 2.2). Sem provedor em volta (um teste da
  // casca sozinha), não há o que limpar.
  const queryClient = useContext(QueryClientContext) ?? null;
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;
  const limparAba = () => {
    recomecar();
    queryClientRef.current?.clear();
  };
  const limparAbaRef = useRef(limparAba);
  limparAbaRef.current = limparAba;

  useEffect(
    () => () => {
      if (!limparAoDesmontar.current) return;
      limparAoDesmontar.current = false;
      limparAbaRef.current();
    },
    [],
  );

  const palco = useMemo<Palco>(
    () => ({
      janeteNoPalco: (sim) => setJaneteNoPalco(sim),
      anunciar: (texto) => setAnuncio(texto),
      recolherBarra: (sim) => setBarraRecolhida(sim),
    }),
    [],
  );

  const focarTitulo = () => {
    const titulo = principal.current?.querySelector<HTMLElement>("h1");
    const alvo = titulo ?? principal.current;
    if (!alvo) return;
    if (!alvo.hasAttribute("tabindex")) alvo.setAttribute("tabindex", "-1");
    alvo.focus({ preventScroll: true });
  };

  // Na troca de etapa o botão clicado some junto com a etapa antiga; sem isto o foco cairia no body.
  useEffect(() => {
    if (etapaAnterior.current === etapa) return;
    etapaAnterior.current = etapa;
    focarTitulo();
  }, [etapa]);

  // Primeira pintura sem voo (depois do Entrar, da conta criada com movimento reduzido, de um link
  // direto ou de recarregar): o botão da tela anterior sumiu e o foco estaria no body. A etapa tem a
  // vez: a conexão leva o foco à primeira opção 60 ms depois, como o F. Se em 100 ms ninguém focou
  // nada, a casca foca o título da etapa. Com o voo do login, quem foca é a etapa, quando o símbolo pousa.
  useEffect(() => {
    if (veioDoLogin) return;
    const t = setTimeout(() => {
      const ativo = document.activeElement;
      if (ativo && ativo !== document.body && ativo !== document.documentElement) return;
      focarTitulo();
    }, 100);
    return () => clearTimeout(t);
    // só na montagem
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Tira de cena o símbolo em trânsito e a legenda dele (o `voo: null, meta: null` do irPara do F). */
  const soltarSimbolo = () => {
    voo.legenda(null);
    voo.soltar();
  };

  // Clique num passo feito: a etapa que está saindo pode estar no meio de um voo que nunca vai
  // terminar. Soltar no mesmo evento faz a etapa nova montar com voo.ativo false.
  const voltarPara = (alvo: Etapa) => {
    soltarSimbolo();
    irPara(alvo);
  };

  // O fim do preparo grava o "concluído" da empresa (concluir_onboarding) e só então vai para /app.
  const concluirNoBanco = async () => {
    if (concluindo) return;
    setConcluindo(true);
    setErroConcluir(null);
    const r = await dados.concluir();
    setConcluindo(false);
    if (!r.ok) {
      setErroConcluir(textoErroConcluir(r.erro));
      setAnuncio("Não conseguimos concluir o onboarding.");
      return;
    }
    concluir();
    aoConcluir();
  };

  const avancarOuConcluir = () => {
    if (!ultima) {
      avancar();
      return;
    }
    void concluirNoBanco();
  };

  const sair = async () => {
    if (saindo) return;
    setSaindo(true);
    soltarSimbolo();
    try {
      const { error } = await firebase.auth.signOut();
      // Sem rede, o signOut global falha e a sessão fica; o local só apaga a sessão desta aba.
      if (error) await firebase.auth.signOut({ scope: "local" });
    } catch {
      try {
        await firebase.auth.signOut({ scope: "local" });
      } catch {
        // sem sessão para apagar
      }
    }
    // Solta de novo: uma chegada pode ter começado um voo durante o signOut.
    soltarSimbolo();
    if (!router) {
      limparAba();
      window.location.assign("/entrar");
      return;
    }
    // Navega antes de limpar: limpar primeiro renderizaria a casca na etapa conexão por um instante
    // (o cartão do WhatsApp piscando antes de /entrar). A limpeza roda quando a casca desmonta.
    limparAoDesmontar.current = true;
    try {
      await router.navigate({ to: "/entrar", replace: true });
    } catch {
      limparAoDesmontar.current = false;
      limparAba();
      window.location.assign("/entrar");
    }
  };

  // A marca da barra só aparece onde a Janete não está no palco (uma marca só, diretriz 11): nas
  // etapas WhatsApp, Cérebro e Voz, fora da validação e sem o símbolo em trânsito por cima. Vale
  // pela etapa, e não pelo índice: a Voz vem depois do despertar, onde a Janete está no palco.
  const mostraMarca = ETAPAS_COM_MARCA.includes(etapa) && !janeteNoPalco && !voo.ativo;
  const viva = indice >= 2;

  return (
    <PalcoContexto.Provider value={palco}>
      <div data-identidade="aipro" className={s.app}>
        <header
          id="onb-nav"
          className={s.nav}
          data-recolhe={barraRecolhida || undefined}
          aria-hidden={barraRecolhida || undefined}
        >
          <div className={s.marca}>
            {mostraMarca ? (
              <span className={s.janete}>
                <BrandLogo withName height={32} />
                <span className={s.janeteEstado} data-on={viva || undefined}>
                  {viva ? "online" : "em repouso"}
                </span>
              </span>
            ) : null}
          </div>
          <nav className={s.passos} aria-label="Etapas do onboarding">
            <ol className={s.passosLista}>
              {TRILHA.map((passo, i) => {
                const n = i + 1;
                const situacao = i === indice ? "atual" : i < indice ? "feito" : "futuro";
                const texto = `Passo ${n} de ${TRILHA.length}, ${passo.rotulo}${
                  situacao === "atual" ? " (atual)" : situacao === "feito" ? " (feito)" : ""
                }`;
                const miolo = (
                  <>
                    <span className={s.sr}>{texto}</span>
                    <span className={s.num} aria-hidden="true">
                      <span className={s.n}>{`0${n}`}</span>
                      <svg className={s.check} viewBox="0 0 24 24">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    </span>
                    <span className={s.rotulo} aria-hidden="true" data-texto={passo.rotulo}>
                      {passo.rotulo}
                    </span>
                  </>
                );
                return (
                  <li key={passo.id} aria-current={situacao === "atual" ? "step" : undefined}>
                    {situacao === "feito" && passo.id !== "plataforma" ? (
                      <button
                        type="button"
                        className={s.passo}
                        data-estado="feito"
                        onClick={() => voltarPara(passo.id as Etapa)}
                      >
                        {miolo}
                      </button>
                    ) : (
                      <span className={s.passo} data-estado={situacao}>
                        {miolo}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
          <div className={s.acao}>
            <button
              type="button"
              className={s.sair}
              onClick={sair}
              disabled={saindo}
              aria-busy={saindo || undefined}
              aria-label="Sair da conta"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="m16 17 5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
              <span className={s.sairTxt}>Sair</span>
            </button>
          </div>
        </header>
        <p className={s.sr} role="status" aria-live="polite">
          {anuncio}
        </p>
        <main ref={principal} className={s.palco}>
          <EtapaAtual avancar={avancarOuConcluir} voltar={voltar} />
        </main>
        {erroConcluir ? (
          <div className={s.falhaConcluir}>
            <Aviso
              tom="erro"
              titulo="Não deu para concluir"
              acao={
                <Botao variante="contorno" tamanho="compacto" onClick={() => void concluirNoBanco()} disabled={concluindo}>
                  Tentar de novo
                </Botao>
              }
            >
              {erroConcluir}
            </Aviso>
          </div>
        ) : null}
      </div>
    </PalcoContexto.Provider>
  );
}
