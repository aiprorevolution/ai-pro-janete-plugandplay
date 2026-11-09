import { useQuery, useQueryClient, useSuspenseQuery, type QueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { firebase } from "@/integrations/firebase/client";

import { ProvedorExemplo, useExemplo } from "../exemplo/ProvedorExemplo";
import { conexaoAtiva, ehAdmin, janelaFechada } from "../exemplo/regras";
import type { CamposContato, CamposEtapa, Conexao, Conversa, EstadoBase, Membro } from "../exemplo/tipos";
import { MAX_NOME_ETAPA } from "../exemplo/reducer";
import { CHAVES, INVALIDA } from "./chaves";
import type { ClienteFirebase } from "./colunas";
import { ProvedorLeiturasConversa, criarLeiturasConversaBanco, criarLeiturasConversaExemplo } from "./conversa";
import { criarEnviador, type ConversaAntes, type RespostaServidor } from "./envio";
import { exigirLinhas, recusado } from "./erros";
import type { AcoesDados, FonteDados, NomeAcao, NovaMensagemDados } from "./fonte";
import { paraLeitura, pronta } from "./leitura";
import { motorValido, opcoesMotor, useConsertoDoMotor } from "./motor";
import {
  filtrarAguardando,
  opcoesAguardando,
  opcoesChaves,
  opcoesConexaoAtiva,
  opcoesConfiguracao,
  opcoesContextoAtual,
  opcoesEtapas,
  opcoesEu,
  opcoesMembros,
} from "./leituras";
import type { Eu, ModoDados, Resultado, VersaoContextoBanco, Vistos } from "./tipos";

// O provedor da camada de dados (spec 2.1, ProvedorDados.tsx; plano, "Peças comuns", item 1):
//   <ProvedorDados fonte="banco">            React Query sobre o QueryClient do router e o cliente
//                                             firebase do navegador, sob RLS;
//   <ProvedorDados exemplo={EstadoBase}>     o reducer do exemplo (ProvedorExemplo, montado aqui
//                                             dentro), com as mesmas ações, agora assíncronas.
// As telas usam só `useDados()`: { useEu, useMembros, ..., acoes }. No modo banco não existe
// ProvedorExemplo (o LayoutBanco não monta): `useExemplo()` só vale no modo exemplo, e os hooks de
// dados/<área>.ts escolhem a implementação por `useModoDados()`.

/**
 * As funções de servidor que a camada chama (spec 2.4, F4: plataforma/dados/servidor.functions.ts).
 * Chegam por parâmetro porque são escritas na F4; sem elas, cada uma tem um padrão seguro.
 */
export interface ServidorDados {
  /** F4 `pedirEnvio()`. Sem ela, a mensagem sai na próxima passada do worker. */
  pedirEnvio?: (() => Promise<unknown>) | undefined;
  /** Pede um toque no motor (spec-motor-acordado): sem ele, o motor acorda na próxima mensagem. */
  acordarMotor?: () => Promise<unknown>;
  /** F4 `garantirBucketMidias()`. Sem ela, conta que o bucket já existe. */
  garantirBucketMidias?: (() => Promise<RespostaServidor>) | undefined;
  /** F4 `marcarLidaNoWhatsApp({ conversaId })`. Sem ela, só zera as não lidas na tela. */
  marcarLidaNoWhatsApp?: ((conversaId: string) => Promise<unknown>) | undefined;
  /** F4 `apagarContato({ contatoId })` (só admin). Sem ela, a ação devolve `falha`. */
  apagarContato?: ((contatoId: string) => Promise<RespostaServidor>) | undefined;
}

interface ValorDados {
  fonte: FonteDados;
  modo: ModoDados;
  /** Nulo no modo exemplo (nada vai ao banco). */
  cliente: ClienteFirebase | null;
}

const DadosContexto = createContext<ValorDados | null>(null);

interface PropsBanco {
  fonte: "banco";
  children: ReactNode;
  /** O cliente do Firebase (testes passam um falso). Padrão: o do navegador. */
  cliente?: ClienteFirebase | undefined;
  servidor?: ServidorDados | undefined;
  /** O Eu sumiu (desativado, ou deixou de ser membro): a casca leva para /sem-acesso (F2). */
  aoPerderAcesso?: (() => void) | undefined;
}

interface PropsExemplo {
  exemplo: EstadoBase | (() => EstadoBase);
  children: ReactNode;
  /** O Contexto atual do exemplo (a empresa e o tom). Padrão: nenhum. */
  contexto?: VersaoContextoBanco | null | undefined;
  /** As mensagens enviadas andam sozinhas até "lida". Padrão: sim (como o ProvedorExemplo). */
  progredirEnvios?: boolean | undefined;
  /** O relógio (testes fixam). */
  relogio?: (() => Date) | undefined;
}

export type PropsProvedorDados = PropsBanco | PropsExemplo;

export function ProvedorDados(props: PropsProvedorDados) {
  if ("exemplo" in props) {
    return (
      <ProvedorExemplo inicial={props.exemplo} progredirEnvios={props.progredirEnvios} relogio={props.relogio}>
        <PonteExemplo contexto={props.contexto ?? null} relogio={props.relogio}>
          {props.children}
        </PonteExemplo>
      </ProvedorExemplo>
    );
  }
  return <ProvedorBanco {...props} />;
}

/** A camada de dados da plataforma. Só dentro do `<ProvedorDados>`. */
export function useDados(): FonteDados {
  const valor = useContext(DadosContexto);
  if (!valor) throw new Error("useDados() precisa do <ProvedorDados> em volta (o Layout da plataforma põe).");
  return valor.fonte;
}

/** "banco" ou "exemplo" (fora do provedor, conta como exemplo). */
export function useModoDados(): ModoDados {
  return useContext(DadosContexto)?.modo ?? "exemplo";
}

/** O cliente do Firebase do modo banco; nulo no exemplo ou fora do provedor. */
export function useClienteDados(): ClienteFirebase | null {
  return useContext(DadosContexto)?.cliente ?? null;
}

/* ---------- apoio ---------- */

/** Os campos do contato como o reducer limpa: aparados, e vazio vira nulo. */
export function limparCamposContato(campos: CamposContato): CamposContato {
  const limpos: CamposContato = {};
  for (const chave of Object.keys(campos) as (keyof CamposContato)[]) {
    const valor = campos[chave];
    if (valor === undefined) continue;
    const limpo = typeof valor === "string" ? valor.trim() : valor;
    limpos[chave] = limpo === "" ? null : limpo;
  }
  return limpos;
}

/** Os campos da etapa como o reducer limpa: nome aparado (até 32), cor vazia vira nula. Nome vazio: null. */
export function limparCamposEtapa(campos: CamposEtapa): CamposEtapa | null {
  const mudanca: CamposEtapa = {};
  if (campos.nome !== undefined) {
    const nome = (campos.nome ?? "").trim().slice(0, MAX_NOME_ETAPA).trim();
    if (!nome) return null;
    mudanca.nome = nome;
  }
  if (campos.cor !== undefined) mudanca.cor = campos.cor?.trim() || null;
  if (campos.janete_pode_mover !== undefined) mudanca.janete_pode_mover = campos.janete_pode_mover;
  if (campos.arquivada !== undefined) mudanca.arquivada = campos.arquivada;
  return mudanca;
}

/**
 * O modo e o responsável da conversa, lidos agora (o mesmo que o gatilho tg_mensagens_apos_inserir e
 * o assumir_conversa leem antes de mudar): dizem se a ação "assume". Qualquer falha devolve null, e a
 * ação segue sem afirmar `assumiu`.
 */
export async function lerConversaAntes(cliente: ClienteFirebase, conversaId: string): Promise<ConversaAntes | null> {
  try {
    const { data, error } = await cliente.from("conversas").select("modo, responsavel_id").eq("id", conversaId).maybeSingle();
    if (error || !data || typeof data !== "object" || Array.isArray(data)) return null;
    const { modo, responsavel_id } = data as { modo?: unknown; responsavel_id?: unknown };
    if (modo !== "janete" && modo !== "humano") return null;
    return { modo, responsavel_id: typeof responsavel_id === "string" ? responsavel_id : null };
  } catch {
    return null;
  }
}

function invalidar(queryClient: QueryClient, acao: NomeAcao) {
  for (const raiz of INVALIDA[acao]) void queryClient.invalidateQueries({ queryKey: CHAVES[raiz] });
}

/** O Eu em cache (a rota /app carregou antes); undefined quando ainda não foi lido. */
function euEmCache(queryClient: QueryClient): Eu["membro"] | null | undefined {
  return queryClient.getQueryData<Eu["membro"] | null>(CHAVES.eu);
}

/**
 * As ações só de admin recusam o atendente antes de ir ao banco, com o mesmo erro do reducer
 * (`sem_permissao`). No banco, a RLS daria outro: `nao_encontrado` (o UPDATE em etapas atinge 0
 * linhas) ou `sem_acesso` (reordenar_etapas, apagarContato). Sem Eu em cache, quem decide é o banco.
 */
function recusaDeAtendente(queryClient: QueryClient): Resultado | null {
  const eu = euEmCache(queryClient);
  return eu && !ehAdmin(eu) ? { ok: false, erro: "sem_permissao" } : null;
}

type ConversaEmCache = Pick<Conversa, "id"> & Partial<Pick<Conversa, "nao_lidas" | "ultima_do_lead_em">>;

/**
 * Acha a conversa do id em qualquer formato de cache (lista, `{ linhas }`, `{ pages }`, uma só, ou a
 * linha do quadro do Kanban, `{ contato, conversa, ultima }`).
 */
function acharConversa(dado: unknown, id: string, fundo = 0): ConversaEmCache | null {
  if (!dado || typeof dado !== "object" || fundo > 3) return null;
  if (Array.isArray(dado)) {
    for (const item of dado) {
      const achada = acharConversa(item, id, fundo + 1);
      if (achada) return achada;
    }
    return null;
  }
  const o = dado as Record<string, unknown>;
  if (o["id"] === id && "nao_lidas" in o) return o as unknown as ConversaEmCache;
  for (const campo of ["linhas", "pages", "conversas", "conversa"]) {
    if (campo in o) {
      const achada = acharConversa(o[campo], id, fundo + 1);
      if (achada) return achada;
    }
  }
  return null;
}

/**
 * A conversa como as telas a têm em cache (Chat, Kanban, Contatos, "Precisam de você"); null se ninguém
 * leu. Com a mesma conversa em mais de um cache, vale a leitura mais recente: um cache velho de outra
 * tela não pode decidir por cima do que acabou de chegar.
 */
export function conversaEmCache(queryClient: QueryClient, conversaId: string): ConversaEmCache | null {
  let melhor: ConversaEmCache | null = null;
  let melhorEm = -1;
  for (const raiz of [CHAVES.conversas, CHAVES.aguardando, CHAVES.quadro, CHAVES.contatos]) {
    for (const consulta of queryClient.getQueryCache().findAll({ queryKey: raiz })) {
      const achada = acharConversa(consulta.state.data, conversaId);
      if (achada && consulta.state.dataUpdatedAt > melhorEm) {
        melhor = achada;
        melhorEm = consulta.state.dataUpdatedAt;
      }
    }
  }
  return melhor;
}

/**
 * Antes de subir um arquivo, as regras que a tela já tem (as mesmas do gatilho
 * tg_mensagens_antes_inserir): sem conexão ativa conectada, `sem_conexao_ativa`; na API oficial com a
 * janela de 24 h fechada, `janela_fechada`. Só com o que está em cache: o que a tela não leu, o banco
 * confere no insert. Assim o arquivo não sobe para ficar sem dono (o authenticated não apaga em
 * storage.objects; ver envio.ts).
 */
export function conferirAntesDoArquivo(queryClient: QueryClient, conversaId: string): Resultado | null {
  const conexao = queryClient.getQueryData<Conexao | null>([...CHAVES.conexao, "ativa"]);
  if (conexao === null || (conexao && !conexaoAtiva({ conexao }))) return { ok: false, erro: "sem_conexao_ativa" };
  const conversa = conversaEmCache(queryClient, conversaId);
  if (conexao && conversa && conversa.ultima_do_lead_em !== undefined) {
    if (janelaFechada({ conexao }, { ultima_do_lead_em: conversa.ultima_do_lead_em }, new Date())) {
      return { ok: false, erro: "janela_fechada" };
    }
  }
  return null;
}

/* ---------- modo banco ---------- */

export function criarAcoesBanco(
  cliente: ClienteFirebase,
  queryClient: QueryClient,
  servidor: ServidorDados = {},
): AcoesDados {
  const enviador = criarEnviador({
    cliente,
    pedirEnvio: servidor.pedirEnvio ?? (() => Promise.resolve()),
    garantirBucketMidias: servidor.garantirBucketMidias ?? (() => Promise.resolve({ ok: true })),
    conferirAntesDoArquivo: (conversaId) => conferirAntesDoArquivo(queryClient, conversaId),
    lerConversaAntes: (conversaId) => lerConversaAntes(cliente, conversaId),
  });

  // Toda ação: nunca lança; deu certo, invalida pela tabela que mudou (INVALIDA); sem_acesso relê o Eu.
  async function executar<T>(acao: NomeAcao, fazer: () => Promise<Resultado<T>>): Promise<Resultado<T>> {
    let r: Resultado<T>;
    try {
      r = await fazer();
    } catch (e) {
      r = recusado(e);
    }
    if (r.ok) invalidar(queryClient, acao);
    else if (r.erro === "sem_acesso") void queryClient.invalidateQueries({ queryKey: CHAVES.eu });
    return r;
  }

  const rpc = async (resposta: PromiseLike<{ error: unknown }>): Promise<Resultado> => {
    const { error } = await resposta;
    return error ? recusado(error) : { ok: true };
  };

  return {
    // O `assumiu` sai do estado da conversa logo antes do insert (envio.ts, assumePorEnvio), como o
    // gatilho decide o evento "assumiu" com `por_envio`: true quando a mensagem tira a conversa da
    // Janete, da espera ou do celular; false quando ela já estava com alguém da equipe.
    enviarMensagem: (conversaId, m: NovaMensagemDados) => executar("enviarMensagem", () => enviador.enviar(conversaId, m)),

    // Como o reducer e o assumir_conversa (que só grava o evento quando a conversa muda de mãos): a
    // conversa que já era da pessoa volta sem `assumiu`. Sem saber o estado de antes (a leitura
    // falhou) ou quem é o Eu, vale `assumiu: true`, o caso de quase sempre.
    assumir: (conversaId) =>
      executar("assumir", async () => {
        const antes = await lerConversaAntes(cliente, conversaId);
        const r = await rpc(cliente.rpc("assumir_conversa", { p_conversa: conversaId }));
        if (!r.ok) return r;
        const eu = euEmCache(queryClient);
        const jaEraMinha = !!antes && !!eu && antes.modo === "humano" && antes.responsavel_id === eu.id;
        return jaEraMinha ? { ok: true } : { ok: true, assumiu: true };
      }),

    // Deu certo, pede um toque no motor sem esperar (spec-motor-acordado): a Janete responde já, e
    // não só na próxima mensagem do lead.
    devolverParaJanete: (conversaId) =>
      executar("devolverParaJanete", async () => {
        const r = await rpc(cliente.rpc("devolver_para_janete", { p_conversa: conversaId }));
        if (r.ok && servidor.acordarMotor) {
          try {
            void Promise.resolve(servidor.acordarMotor()).catch(() => {});
          } catch {
            // um toque que falha é aceito (decisão 2): a próxima mensagem acorda o motor
          }
        }
        return r;
      }),

    // Sempre vai ao banco: quem decide se há o que marcar é a tela, pela leitura que ela tem aberta
    // (Chat, Kanban e Contatos só chamam com não lidas). Um atalho por cache podia ler a cópia velha de
    // outra tela e deixar de marcar (decisão 6).
    marcarLida: async (conversaId) => {
      return executar("marcarLida", async () => {
        const r = await rpc(cliente.rpc("marcar_lida", { p_conversa: conversaId }));
        // O "lido" no WhatsApp (decisão 6) vai depois, sem esperar: a tela não depende dele.
        if (r.ok && servidor.marcarLidaNoWhatsApp) {
          try {
            void Promise.resolve(servidor.marcarLidaNoWhatsApp(conversaId)).catch(() => {});
          } catch {
            // sem o lido no WhatsApp, a conversa continua lida na tela
          }
        }
        return r;
      });
    },

    tentarDeNovo: (mensagemId) =>
      executar("tentarDeNovo", async () => {
        // A mensagem da equipe que falhou volta para na_fila (o banco recusa nao_reenviavel, decisão 8).
        const r = await rpc(cliente.rpc("reenviar_mensagem", { p_msg: mensagemId }));
        if (r.ok) {
          enviador.pedirEnvioSemEsperar();
          return { ok: true, id: mensagemId };
        }
        return r;
      }),

    moverEtapa: (contatoId, etapaId) =>
      executar("moverEtapa", async () => {
        exigirLinhas(await cliente.from("contatos").update({ etapa_id: etapaId }).eq("id", contatoId).select("id"), "contatos");
        return { ok: true };
      }),

    editarContato: (contatoId, campos) =>
      executar("editarContato", async () => {
        const limpos = limparCamposContato(campos);
        if (Object.keys(limpos).length === 0) return { ok: true };
        exigirLinhas(await cliente.from("contatos").update(limpos).eq("id", contatoId).select("id"), "contatos");
        return { ok: true };
      }),

    editarEtapa: (etapaId, campos) =>
      executar("editarEtapa", async () => {
        const recusa = recusaDeAtendente(queryClient);
        if (recusa) return recusa;
        const mudanca = limparCamposEtapa(campos);
        if (!mudanca) return { ok: false, erro: "nome_vazio" };
        if (Object.keys(mudanca).length === 0) return { ok: true };
        exigirLinhas(await cliente.from("etapas").update(mudanca).eq("id", etapaId).select("id"), "etapas");
        return { ok: true };
      }),

    // Tudo de uma vez, num grupo só (as abertas, ou Ganho e Perdido); grupos misturados: sem_permissao.
    reordenarEtapas: (ids) =>
      executar("reordenarEtapas", async () => recusaDeAtendente(queryClient) ?? rpc(cliente.rpc("reordenar_etapas", { p_ids: ids }))),

    apagarContato: (contatoId) =>
      executar("apagarContato", async (): Promise<Resultado> => {
        const recusa = recusaDeAtendente(queryClient);
        if (recusa) return recusa;
        // F4: a função de servidor apaga as mídias do bucket e depois o contato (só admin).
        if (!servidor.apagarContato) return { ok: false, erro: "falha", detalhe: "apagarContato ainda não ligado (F4)" };
        const r = await servidor.apagarContato(contatoId);
        if (r && r.ok === false) return recusado(r);
        return { ok: true };
      }),

    marcarVisto: (onde) =>
      executar("marcarVisto", async (): Promise<Resultado<string>> => {
        // Grava `membros.vistos[onde]` = agora e devolve o momento gravado.
        const { data, error } = await cliente.rpc("marcar_visto", { p_onde: onde });
        if (error) return recusado(error);
        return typeof data === "string" ? { ok: true, valor: data } : { ok: true };
      }),
  };
}

function ProvedorBanco({ children, cliente: clienteProp, servidor, aoPerderAcesso }: PropsBanco) {
  const queryClient = useQueryClient();
  const cliente = clienteProp ?? firebase;
  const servidorRef = useRef(servidor);
  servidorRef.current = servidor;

  // O último Eu conhecido: se o membro for desativado no meio da sessão, as telas não quebram
  // enquanto a casca leva para /sem-acesso.
  const ultimoEu = useRef<Eu["membro"] | null>(null);
  const eu = useQuery(opcoesEu(cliente));
  if (eu.data) ultimoEu.current = eu.data;
  const perdeu = eu.isSuccess && eu.data === null;
  const aoPerderRef = useRef(aoPerderAcesso);
  aoPerderRef.current = aoPerderAcesso;
  useEffect(() => {
    if (perdeu) aoPerderRef.current?.();
  }, [perdeu]);

  const fonte = useMemo<FonteDados>(() => {
    const acoes = criarAcoesBanco(cliente, queryClient, {
      pedirEnvio: () => servidorRef.current?.pedirEnvio?.() ?? Promise.resolve(),
      acordarMotor: () => servidorRef.current?.acordarMotor?.() ?? Promise.resolve(),
      garantirBucketMidias: () => servidorRef.current?.garantirBucketMidias?.() ?? Promise.resolve({ ok: true }),
      marcarLidaNoWhatsApp: (id) => servidorRef.current?.marcarLidaNoWhatsApp?.(id) ?? Promise.resolve(),
      apagarContato: (id) =>
        servidorRef.current?.apagarContato?.(id) ??
        Promise.resolve({ ok: false, erro: "falha", mensagem: "apagarContato ainda não ligado (F4)" }),
    });
    return {
      useEu: () => {
        const { data } = useSuspenseQuery(opcoesEu(cliente));
        const membro = data ?? ultimoEu.current;
        const valor = useMemo<Eu | null>(() => (membro ? { membro, ehAdmin: ehAdmin(membro) } : null), [membro]);
        if (!valor) throw new Error("useEu(): a conta não é membro ativo (a rota /app leva para /sem-acesso antes).");
        return valor;
      },
      useMembros: () => paraLeitura(useQuery(opcoesMembros(cliente))),
      useEtapas: () => paraLeitura(useQuery(opcoesEtapas(cliente))),
      useConexaoAtiva: () => paraLeitura(useQuery(opcoesConexaoAtiva(cliente))),
      useConfiguracao: () => paraLeitura(useQuery(opcoesConfiguracao(cliente))),
      // avaliada a cada render: a leitura envelhece com o relógio da tela
      useMotor: () => motorValido(useQuery(opcoesMotor(cliente)), Date.now()),
      useContextoAtual: () => paraLeitura(useQuery(opcoesContextoAtual(cliente))),
      useAguardando: () => paraLeitura(useQuery(opcoesAguardando(cliente))),
      useChaves: () => {
        const euQ = useQuery(opcoesEu(cliente));
        const admin = ehAdmin(euQ.data ?? ultimoEu.current);
        const q = useQuery(opcoesChaves(cliente, admin));
        const vazia = useMemo(() => pronta([]), []);
        if (!admin) return euQ.isPending ? { ...vazia, dados: undefined, carregando: true } : vazia;
        return paraLeitura(q);
      },
      acoes,
    };
  }, [cliente, queryClient]);
  const leiturasConversa = useMemo(() => criarLeiturasConversaBanco(cliente), [cliente]);

  const valor = useMemo<ValorDados>(() => ({ fonte, modo: "banco", cliente }), [fonte, cliente]);
  return (
    <DadosContexto.Provider value={valor}>
      {/* o conserto sozinho vale para toda área aberta; só com a função de servidor (a rota passa) */}
      {servidor?.acordarMotor ? (
        <ConsertoDoMotor cliente={cliente} acordar={() => servidorRef.current?.acordarMotor?.()} />
      ) : null}
      <ProvedorLeiturasConversa value={leiturasConversa}>{children}</ProvedorLeiturasConversa>
    </DadosContexto.Provider>
  );
}

/** A leitura do motor e o toque quando algo venceu há mais de 60 s (decisão 2). Não desenha nada. */
function ConsertoDoMotor({
  cliente,
  acordar,
}: {
  cliente: ClienteFirebase;
  acordar: () => Promise<unknown> | undefined;
}) {
  useConsertoDoMotor(cliente, acordar);
  return null;
}

/** As leituras de conversa do modo exemplo não dependem de nada: uma só para todos os provedores. */
const LEITURAS_CONVERSA_EXEMPLO = criarLeiturasConversaExemplo();

/* ---------- modo exemplo ---------- */

/** As ações do exemplo, assíncronas, no formato da camada (os testes usam este modo). */
function PonteExemplo({
  children,
  contexto,
  relogio,
}: {
  children: ReactNode;
  contexto: VersaoContextoBanco | null;
  relogio?: (() => Date) | undefined;
}) {
  const { estado, acoes } = useExemplo();
  const euRef = useRef<Membro>(estado.eu);
  euRef.current = estado.eu;
  const relogioRef = useRef(relogio ?? (() => new Date()));
  relogioRef.current = relogio ?? (() => new Date());
  // O "visto" por pessoa (decisão 13 e 15). No exemplo, fica em memória.
  const [vistos, setVistos] = useState<Record<string, Vistos>>({});

  const acoesDados = useMemo<AcoesDados>(
    () => ({
      enviarMensagem: async (conversaId, m) => {
        const { arquivo, ...nova } = m;
        const midia =
          nova.midia ??
          (arquivo
            ? { nome: arquivo instanceof File ? arquivo.name : "arquivo", mime: arquivo.type || null, tamanho: arquivo.size }
            : nova.midia);
        return acoes.enviarMensagem(conversaId, midia === undefined ? nova : { ...nova, midia });
      },
      assumir: async (conversaId) => acoes.assumir(conversaId),
      devolverParaJanete: async (conversaId) => acoes.devolverParaJanete(conversaId),
      marcarLida: async (conversaId) => acoes.marcarLida(conversaId),
      tentarDeNovo: async (mensagemId) => acoes.tentarDeNovo(mensagemId),
      moverEtapa: async (contatoId, etapaId) => acoes.moverEtapa(contatoId, etapaId, "membro"),
      editarContato: async (contatoId, campos) => acoes.editarContato(contatoId, campos),
      editarEtapa: async (etapaId, campos) => acoes.editarEtapa(etapaId, campos),
      reordenarEtapas: async (ids) => acoes.reordenarEtapas(ids),
      apagarContato: async (contatoId) => acoes.apagarContato(contatoId),
      marcarVisto: async (onde) => {
        const em = relogioRef.current().toISOString();
        const id = euRef.current.id;
        setVistos((v) => ({ ...v, [id]: { ...v[id], [onde]: em } }));
        return { ok: true, valor: em };
      },
    }),
    [acoes],
  );

  const fonte = useMemo<FonteDados>(
    () => ({
      useEu: () => {
        const { estado: e } = useExemplo();
        return useMemo(() => ({ membro: { ...e.eu, vistos: vistos[e.eu.id] ?? {} }, ehAdmin: ehAdmin(e.eu) }), [e.eu, vistos]);
      },
      useMembros: () => {
        const { estado: e } = useExemplo();
        return useMemo(() => pronta(e.membros), [e.membros]);
      },
      useEtapas: () => {
        const { estado: e } = useExemplo();
        return useMemo(() => pronta([...e.etapas].sort((a, b) => a.ordem - b.ordem)), [e.etapas]);
      },
      useConexaoAtiva: () => {
        const { estado: e } = useExemplo();
        // Como no banco: só a conexão com `ativa` conta.
        return useMemo(() => pronta(e.conexao?.ativa ? e.conexao : null), [e.conexao]);
      },
      useConfiguracao: () => {
        const { estado: e } = useExemplo();
        return useMemo(() => pronta({ ...e.configuracao, worker_visto_em: null }), [e.configuracao]);
      },
      // o exemplo não tem motor: nada a ler, nada a avisar
      useMotor: () => undefined,
      useContextoAtual: () => useMemo(() => pronta(contexto), [contexto]),
      useAguardando: () => {
        const { estado: e } = useExemplo();
        return useMemo(() => pronta(filtrarAguardando(e.conversas)), [e.conversas]);
      },
      useChaves: () => {
        const { estado: e } = useExemplo();
        // O ProvedorExemplo já entrega [] para o atendente (como a policy ia_chaves_admin_le).
        return useMemo(() => pronta(e.chaves), [e.chaves]);
      },
      acoes: acoesDados,
    }),
    [acoesDados, vistos, contexto],
  );

  const valor = useMemo<ValorDados>(() => ({ fonte, modo: "exemplo", cliente: null }), [fonte]);
  return (
    <DadosContexto.Provider value={valor}>
      <ProvedorLeiturasConversa value={LEITURAS_CONVERSA_EXEMPLO}>{children}</ProvedorLeiturasConversa>
    </DadosContexto.Provider>
  );
}
