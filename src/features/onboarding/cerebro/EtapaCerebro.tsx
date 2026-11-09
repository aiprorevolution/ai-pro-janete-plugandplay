import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Botao, Campo, Giro, cx } from "@/components/aipro";
import { medirJanete, movimentoReduzido, rolarAteEMedir, useVooJanete, type PontoJanete } from "@/components/janete/VooJanete";
import type { PropsEtapa } from "@/features/onboarding/Onboarding";
import { useOnboarding } from "@/features/onboarding/estado";
import { FusaoJanete } from "@/features/onboarding/fusao";
import { useJaneteNoPalco, usePalco } from "@/features/onboarding/palco";
import type { EntradaSalvarChaveIA, ResultadoSalvarChaveIA } from "@/features/mensageria/configuracao.functions";
import { AVISO_ANTHROPIC_SEM_ESCUTA } from "@/features/plataforma/configuracao/leitura";
import { useDadosOnboarding } from "@/features/plataforma/dados/onboarding";
import type { ErroChaveIA, ProvedorIA } from "@/features/servidor/chave-ia";
import type { EntradaListarModelos, ModeloListado, ResultadoListarModelos } from "@/features/servidor/listar-modelos";
import { listarModelos, type SemAcessoServidor } from "@/features/servidor/listar-modelos.functions";

import {
  AvisoErro,
  BlocoOk,
  BotaoCompacto,
  CartaoLista,
  Dobra,
  FASES_PALCO,
  GIRO_IA_MS,
  IC,
  Icone,
  Linha,
  LogoTile,
  MENSAGEM_SEM_RESPOSTA,
  MENSAGEM_SEM_SESSAO,
  MOTORES,
  mensagemDoResultado,
  OutrosRodape,
  PROVS,
  PainelCab,
  PalcoValidacao,
  acharMotor,
  consumirDesdobra,
  curto,
  desdobraPedido,
  irParaEntrar,
  juntar,
  lerCampo,
  limparCampo,
  s,
  separarMensagem,
  sessaoTerminou,
  useDepois,
  usePainelMontado,
  useValidacao,
  type Desfecho,
  type EntradaCartao,
  type Fase,
  type Motor,
} from "../lista";

import {
  LIMITE_INICIAL,
  LIMITE_PASSO,
  listaDeReserva,
  modeloInicial,
  nomeDoModelo,
  opcoesDe,
  semFabricante,
  visiveisDe,
  type OpcaoModelo,
} from "./modelosTela";

/** O contêiner do cérebro desdobrando do check do WhatsApp (irCerebro do F). */
const DESDOBRA_MS = 780;
/** Tamanho mínimo da chave para liberar "Buscar modelos" e "Validar chave" (F). */
const CHAVE_MINIMA = 8;

/** Os códigos de erro da lista de modelos e os do salvarChaveIA (sem_acesso, gravação). */
type CodigoErroIA = ErroChaveIA | Extract<ResultadoSalvarChaveIA, { ok: false }>["erro"];

interface ErroIATela {
  codigo: CodigoErroIA | null;
  titulo: string;
  texto: string;
  /** A chamada foi recusada porque a sessão terminou: a ação leva para o login. */
  semSessao?: boolean;
}

/**
 * A lista de modelos do motor aberto. Na Anthropic e na OpenAI ela só vem com a chave (buscar a
 * lista confere a chave); no OpenRouter ela é pública e vem ao abrir. `reserva`: o OpenRouter não
 * respondeu e a tela mostra a lista curada, com aviso.
 */
type EstadoLista =
  | { estado: "vazia" }
  | { estado: "buscando" }
  | { estado: "pronta"; modelos: ModeloListado[]; reserva: boolean }
  | { estado: "falhou"; titulo: string; texto: string; semSessao?: boolean };

const LISTA_VAZIA: EstadoLista = { estado: "vazia" };

const ERROS_DE_CHAVE: readonly string[] = ["chave_invalida", "sem_permissao", "sem_credito"];

const idChave = (motor: ProvedorIA) => `chave-${motor}`;

function estadoDoErro(codigo: CodigoErroIA | null): string {
  if (codigo && (ERROS_DE_CHAVE.includes(codigo) || codigo === "workspace_necessario")) return "Chave recusada";
  if (codigo === "modelo_indisponivel") return "Modelo indisponível";
  if (codigo === "sem_acesso") return "Sem acesso";
  if (codigo === "cifra_indisponivel" || codigo === "erro_ao_gravar") return "Não guardou";
  return "Não validou";
}

function corrigirDoErro(codigo: CodigoErroIA | null): string {
  if (codigo && ERROS_DE_CHAVE.includes(codigo)) return "Colar outra chave";
  if (codigo === "workspace_necessario") return "Informar o workspace";
  if (codigo === "modelo_indisponivel") return "Escolher outro modelo";
  return "Voltar";
}

function avisoDoErro(codigo: CodigoErroIA | null): string {
  if (codigo && ERROS_DE_CHAVE.includes(codigo)) return "Cole uma chave nova e valide de novo.";
  if (codigo === "sem_acesso") return "Só o admin pode configurar a Janete.";
  if (codigo === "workspace_necessario") return "Informe o ID do workspace e valide de novo.";
  if (codigo === "modelo_indisponivel") return "Escolha outro modelo e valide de novo.";
  return "Valide de novo em instantes.";
}

/** "da Anthropic", "da OpenAI", "pelo OpenRouter" (o OpenRouter só repassa modelos de outros fabricantes). */
function deOndeVem(m: Motor): string {
  return m.busca ? `pel${m.artigo} ${m.nome}` : `d${m.artigo} ${m.nome}`;
}

/** 2c: o resultado em linguagem simples, sem a chave e sem "••••". */
export function fraseDoModelo(m: Motor, nome: string | null): string {
  return nome ? `Ela vai usar o ${nome}, ${deOndeVem(m)}.` : `Ela vai usar um modelo ${deOndeVem(m)}.`;
}

/**
 * Etapa 2 · Cérebro (a mesma lista do WhatsApp, no F). Escolhe o motor; a lista de modelos vem do
 * provedor, na hora (listarModelos). Na Anthropic e na OpenAI a chave vem antes da lista, e buscar
 * a lista já confere a chave; no OpenRouter a lista abre já com a busca e a chave vem depois.
 * "Validar chave" testa o modelo escolhido no provedor e grava a chave de resposta (salvarChaveIA, no servidor).
 * Do sucesso ficam só o provedor, o modelo e o `ultimos4`; a chave sai da memória do componente.
 * A chave fica só no `<input>` (não controlado, ver lista/campos.ts): o estado guarda o tamanho.
 * Depois do "Próximo", a cena FusaoJanete leva a Janete, já acordada, até o despertar.
 */
export function EtapaCerebro({ avancar, voltar }: PropsEtapa) {
  const { estado, definirCerebro } = useOnboarding();
  const dados = useDadosOnboarding();
  const voo = useVooJanete();
  const { anunciar } = usePalco();
  const { depois, focar } = useDepois();

  const inicial = useRef(estado.cerebro).current;
  const jaValidada = !!inicial.ultimos4 && !!inicial.provedor;
  const [motorId, setMotorId] = useState<ProvedorIA | null>(inicial.provedor);
  const [modelo, setModelo] = useState<string | null>(inicial.modelo);
  const [busca, setBusca] = useState("");
  const [lista, setLista] = useState<EstadoLista>(LISTA_VAZIA);
  const [limite, setLimite] = useState(LIMITE_INICIAL);
  const [tamanhoChave, setTamanhoChave] = useState(0);
  const [erroChave, setErroChave] = useState<string | null>(null);
  const [verChave, setVerChave] = useState(false);
  const [workspace, setWorkspace] = useState("");
  const [pedeWorkspace, setPedeWorkspace] = useState(false);
  const [erroWorkspace, setErroWorkspace] = useState<string | null>(null);
  const [ultimos4, setUltimos4] = useState<string | null>(jaValidada ? inicial.ultimos4 : null);
  // Voltou já validada: o nome vem da lista curada (Anthropic e OpenAI). No OpenRouter a curada só
  // tem o id ("anthropic/claude-haiku-5.5"): a frase fica sem nome até a lista pública chegar (abaixo).
  const [nomeOk, setNomeOk] = useState<string | null>(() =>
    jaValidada && inicial.provedor && inicial.modelo && !acharMotor(inicial.provedor)?.busca
      ? nomeDoModelo(inicial.provedor, inicial.modelo)
      : null,
  );
  const [erro, setErro] = useState<ErroIATela | null>(null);
  const [avisoIA, setAvisoIA] = useState<{ titulo: string; texto: string } | null>(null);
  // "Próximo": `saindo` desde o clique; `fusao` com o ponto medido do check, quando a cena começa
  const [saindo, setSaindo] = useState(false);
  const [fusao, setFusao] = useState<PontoJanete | null>(null);
  const val = useValidacao(GIRO_IA_MS, jaValidada ? "ok" : "form");
  const fase = val.fase;
  const [entrada, setEntrada] = useState<EntradaCartao>(() =>
    desdobraPedido() && !movimentoReduzido() && !jaValidada ? "desdobrando" : null,
  );
  const painelMontado = usePainelMontado(motorId);
  // para onde o foco vai quando o formulário reabre
  const alvoFoco = useRef<string | null>(null);
  // cada busca da lista tem um número: a resposta de uma busca antiga (motor trocado, chave editada) é ignorada
  const pedidoLista = useRef(0);
  const montado = useRef(true);
  useEffect(() => {
    // Religa na (re)montagem: em desenvolvimento o React monta duas vezes, e sem isto o marcador
    // ficava desligado para sempre e toda resposta da lista era ignorada ("Buscando…" sem fim).
    montado.current = true;
    return () => {
      montado.current = false;
      pedidoLista.current += 1;
    };
  }, []);

  // OpenRouter, voltou já validada: o nome do modelo vem da lista pública (sem chave), como na validação
  const pedidoNome = useRef(0);
  useEffect(() => {
    const provedor = inicial.provedor;
    const id = inicial.modelo;
    if (!jaValidada || !provedor || !id || !acharMotor(provedor)?.busca) return;
    const pedido = ++pedidoNome.current;
    listarModelos({ data: { provedor } }).then(
      (r: ResultadoListarModelos | SemAcessoServidor) => {
        if (!montado.current || pedido !== pedidoNome.current || !r.ok) return;
        const achado = r.modelos.find((m) => m.id === id);
        if (achado?.nome && achado.nome !== achado.id) setNomeOk(semFabricante(achado.nome));
      },
      () => {},
    );
    return () => {
      pedidoNome.current += 1;
    };
    // só na montagem
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const motor = acharMotor(motorId);
  const validando = FASES_PALCO.includes(fase) && !!motor;
  useJaneteNoPalco(validando);

  /* ---------- o check do WhatsApp se desdobra neste contêiner ---------- */
  useEffect(() => {
    consumirDesdobra();
    if (entrada !== "desdobrando") return;
    const t = setTimeout(() => setEntrada(null), DESDOBRA_MS);
    return () => clearTimeout(t);
    // só na montagem
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // voltou já validada (estado da aba): o foco vai para a ação do resultado
  useEffect(() => {
    if (jaValidada) focar("val-pri");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- foco depois de cada transição ---------- */
  const faseAnterior = useRef<Fase>(fase);
  useEffect(() => {
    const antes = faseAnterior.current;
    faseAnterior.current = fase;
    if (antes === fase) return;
    if (fase === "ok" || fase === "erro") {
      focar("val-pri", { rolar: true });
      return;
    }
    if (fase === "form" && (antes === "reabrindo" || antes === "ok" || antes === "erro")) {
      const alvo = alvoFoco.current;
      alvoFoco.current = null;
      focar(alvo ?? (motorId ? idChave(motorId) : "lista-cartao"), { rolar: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fase]);

  // decisão 1 das lacunas: a Anthropic não transcreve, e no onboarding a escuta só chega com a voz
  // (ElevenLabs), na etapa seguinte, que copia a mesma chave para a escuta se ela estiver livre:
  // quem volta a este passo já com a voz não vê o aviso, nem quem já gravou uma chave de Escuta ou
  // de voz (na Configuração, por exemplo).
  const semEscuta = motorId === "anthropic" && !estado.voz.ultimos4 && !dados.gravado.dados?.escuta;

  /* ---------- anúncios ---------- */
  const comMotor = motor ? `com ${motor.artigo} ${motor.nome}` : "";
  const fraseOk = motor ? fraseDoModelo(motor, nomeOk) : "";
  useEffect(() => {
    if (!motor) return;
    if (fase === "verificando") anunciar(`Validando a chave ${comMotor}…`);
    // o foco vai para o "Próximo" e pula o aviso do áudio: ele entra no anúncio da chave aceita
    else if (fase === "ok" && ultimos4) anunciar(`Chave aceita. ${fraseOk}${semEscuta ? ` ${AVISO_ANTHROPIC_SEM_ESCUTA}` : ""}`);
    else if (fase === "erro" && erro) anunciar(`${estadoDoErro(erro.codigo)}. ${erro.titulo}`);
  }, [anunciar, comMotor, erro, fase, fraseOk, motor, semEscuta, ultimos4]);

  /* ---------- a lista de modelos (listarModelos) ---------- */
  const mov = () => !movimentoReduzido();

  /** Esquece a lista (e cancela a busca em andamento): a chave ou o workspace mudaram. */
  const esquecerLista = () => {
    pedidoLista.current += 1;
    setLista(LISTA_VAZIA);
    setLimite(LIMITE_INICIAL);
  };

  const listaPronta = (m: Motor, modelos: ModeloListado[], reserva: boolean) => {
    setLista({ estado: "pronta", modelos, reserva });
    setLimite(LIMITE_INICIAL);
    const escolhido = modeloInicial(modelos, modelo, !!m.busca);
    setModelo(escolhido);
    definirCerebro({ modelo: escolhido });
    // Anthropic e OpenAI: a lista chegou depois do clique em "Buscar modelos"; o foco vai para o
    // modelo marcado. No OpenRouter a pessoa pode estar digitando na busca: o foco fica onde está.
    if (!m.busca) {
      const ops = visiveisDe(opcoesDe(modelos, { busca: false, termo: "", atual: escolhido }), LIMITE_INICIAL, escolhido);
      const i = ops.findIndex((o) => o.id === escolhido);
      focar(`md-${m.id}-${Math.max(0, i)}`, { rolar: true });
    }
  };

  const buscarModelos = () => {
    const m = motor;
    if (!m || fase !== "form") return;
    const provedor = m.id;
    const data: EntradaListarModelos = { provedor };
    if (!m.busca) {
      const k = lerCampo(idChave(provedor)).trim();
      if (k.length < CHAVE_MINIMA) return;
      data.chave = k;
      const ws = provedor === "anthropic" ? workspace.trim() : "";
      if (ws) data.workspaceId = ws;
    }
    const pedido = ++pedidoLista.current;
    setLista({ estado: "buscando" });
    setErroChave(null);
    setErroWorkspace(null);
    setAvisoIA(null);
    const vale = () => montado.current && pedido === pedidoLista.current;
    listarModelos({ data }).then(
      (r: ResultadoListarModelos | SemAcessoServidor) => {
        if (!vale()) return;
        if (r.ok) {
          listaPronta(m, r.modelos, r.origem === "lista_curada");
          return;
        }
        // a conta não é membro ativo: não adianta a lista curada, o salvar também vai recusar
        if (r.erro === "sem_acesso") {
          setLista({ estado: "falhou", ...separarMensagem(r.mensagem) });
          return;
        }
        // o OpenRouter fora do ar: segue com a lista curada, com aviso
        if (m.busca) {
          listaPronta(m, listaDeReserva(provedor), true);
          return;
        }
        setLista(LISTA_VAZIA);
        if (ERROS_DE_CHAVE.includes(r.erro)) {
          setErroChave(r.mensagem);
          focar(idChave(provedor));
        } else if (r.erro === "workspace_necessario") {
          setPedeWorkspace(true);
          setErroWorkspace(r.mensagem);
          focar("workspace-anthropic");
        } else {
          setLista({ estado: "falhou", ...separarMensagem(r.mensagem) });
        }
      },
      async () => {
        const semSessao = await sessaoTerminou();
        if (!vale()) return;
        if (semSessao) setLista({ estado: "falhou", ...separarMensagem(MENSAGEM_SEM_SESSAO), semSessao: true });
        else if (m.busca) listaPronta(m, listaDeReserva(provedor), true);
        else setLista({ estado: "falhou", ...separarMensagem(MENSAGEM_SEM_RESPOSTA) });
      },
    );
  };

  // OpenRouter: a lista é pública e abre sozinha (também ao reabrir depois de "Trocar chave")
  useEffect(() => {
    if (motor?.busca && fase === "form" && lista.estado === "vazia") buscarModelos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motorId, fase, lista.estado]);

  /* ---------- escolhas ---------- */

  /** Apaga a chave do campo (e da memória: o estado só tem o tamanho). A lista era desta chave. */
  const apagarChave = (id: ProvedorIA | null) => {
    if (id) limparCampo(idChave(id));
    setTamanhoChave(0);
    if (id && !acharMotor(id)?.busca) esquecerLista();
  };

  const limparPainel = () => {
    setBusca("");
    setErroChave(null);
    setVerChave(false);
    setWorkspace("");
    setPedeWorkspace(false);
    setErroWorkspace(null);
    setAvisoIA(null);
    esquecerLista();
  };

  const escolherMotor = (id: ProvedorIA) => {
    if (fase !== "form" || val.preparando) return;
    setMotorId(id);
    setModelo(null);
    apagarChave(id);
    limparPainel();
    definirCerebro({ provedor: id, modelo: null, ultimos4: null });
    // Anthropic e OpenAI começam pela chave; o OpenRouter, pela busca
    focar(acharMotor(id)?.busca ? `busca-${id}` : idChave(id), { atrasoMs: mov() ? 380 : 0 });
  };

  const voltarMotor = () => {
    // durante o preparo da validação (a página rolando até o disco) o motor não muda
    if (fase !== "form" || val.preparando) return;
    const antes = motorId;
    setMotorId(null);
    setModelo(null);
    apagarChave(antes);
    limparPainel();
    definirCerebro({ provedor: null, modelo: null, ultimos4: null });
    if (antes) focar(`linha-${antes}`, { atrasoMs: mov() ? 380 : 0 });
  };

  const escolherModelo = (id: string) => {
    setModelo(id);
    definirCerebro({ modelo: id });
  };

  const modelosDaLista = lista.estado === "pronta" ? lista.modelos : [];
  const podeBuscar = !!motor && !motor.busca && tamanhoChave >= CHAVE_MINIMA && fase === "form" && lista.estado !== "buscando";
  const bloqueado = !motorId || !modelo || tamanhoChave < CHAVE_MINIMA || fase !== "form" || lista.estado !== "pronta";

  /* ---------- validação ---------- */
  const validar = () => {
    if (!motorId || !modelo || !motor) return;
    const k = lerCampo(idChave(motorId)).trim();
    if (k.length < CHAVE_MINIMA) return;
    const provedor = motorId;
    const modeloId = modelo;
    const nome = semFabricante(nomeDoModelo(provedor, modeloId, modelosDaLista));
    const ws = provedor === "anthropic" ? workspace.trim() : "";
    setAvisoIA(null);
    setErroChave(null);
    setVerChave(false);
    // Testa e grava de uma vez (salvarChaveIA confere no provedor antes de guardar). Sem o workspace
    // digitado, o servidor mantém o que já estava gravado para o mesmo provedor.
    const entrada: EntradaSalvarChaveIA = { finalidade: "resposta", provedor, modelo: modeloId, chave: k };
    if (ws) entrada.workspace_id = ws;
    val.validar<ResultadoSalvarChaveIA>({
      chamar: () => dados.salvarChaveIA(entrada),
      concluir: (d: Desfecho<ResultadoSalvarChaveIA>) => {
        if (d.tipo === "resposta" && d.valor.ok) {
          setUltimos4(d.valor.ultimos4);
          setNomeOk(nome);
          definirCerebro({ provedor, modelo: modeloId, ultimos4: d.valor.ultimos4 });
          // sucesso: a chave sai da tela e da memória do componente
          apagarChave(provedor);
          setErro(null);
          return "ok";
        }
        if (d.tipo === "sem_sessao") {
          setErro({ codigo: null, ...separarMensagem(MENSAGEM_SEM_SESSAO), semSessao: true });
          return "erro";
        }
        const codigo = d.tipo === "resposta" && !d.valor.ok ? d.valor.erro : null;
        const mensagem = d.tipo === "resposta" && !d.valor.ok ? mensagemDoResultado(d.valor) : MENSAGEM_SEM_RESPOSTA;
        setErro({ codigo, ...separarMensagem(mensagem) });
        return "erro";
      },
    });
  };

  const corrigir = () => {
    if (saindo) return;
    const e = erro;
    if (e?.semSessao) {
      irParaEntrar();
      return;
    }
    const codigo = e?.codigo ?? null;
    val.reabrir(() => {
      if (e) setAvisoIA({ titulo: e.titulo, texto: avisoDoErro(codigo) });
      if (codigo && ERROS_DE_CHAVE.includes(codigo)) {
        apagarChave(motorId);
        setErroChave(e ? e.texto || e.titulo : null);
        alvoFoco.current = motorId ? idChave(motorId) : null;
      } else if (codigo === "workspace_necessario") {
        setPedeWorkspace(true);
        setErroWorkspace(e ? e.titulo : null);
        alvoFoco.current = "workspace-anthropic";
      } else if (codigo === "modelo_indisponivel" && motor) {
        const ops = visiveisDe(opcoesDe(modelosDaLista, { busca: !!motor.busca, termo: busca, atual: modelo }), limite, modelo);
        const i = ops.findIndex((o) => o.id === modelo);
        alvoFoco.current = `md-${motor.id}-${Math.max(0, i)}`;
      }
    });
  };

  const trocarChave = () => {
    // a cena da fusão já começou: a chave validada fica (a cena termina no despertar)
    if (saindo) return;
    // o nome que a lista pública ainda ia trazer (voltou já validada) é da chave que sai
    pedidoNome.current += 1;
    val.reabrir(() => {
      apagarChave(motorId);
      setErroChave(null);
      setUltimos4(null);
      setNomeOk(null);
      setAvisoIA(null);
      definirCerebro({ ultimos4: null });
    });
  };

  // 2 → 3: o check vira de novo o logo, a Janete surge e se funde a ele (FusaoJanete), e o símbolo
  // fica em trânsito até o "Oi, eu sou a Janete"
  const proximoJanete = () => {
    if (saindo || fase !== "ok") return;
    if (!mov() || !motor) {
      avancar();
      return;
    }
    setSaindo(true);
    // A cena é fixa na tela: mede o check só com o disco inteiro na vista, abaixo da barra de etapas
    // (a mira já desconta a barra), e com a página parada.
    const seguir = () => {
      if (!montado.current) return;
      const ponto = medirJanete("val-disco");
      if (!ponto) {
        avancar();
        return;
      }
      setFusao(ponto);
    };
    void rolarAteEMedir("disco-mira", { bloco: "center" }).then(seguir, seguir);
  };

  const terminarFusao = (ponto: PontoJanete) => {
    voo.pousar(ponto, "acordada");
    avancar();
  };

  /* ---------- tela ---------- */
  const conexao = estado.conexao;
  const whatsConectado = !!conexao.rotulo && !!conexao.gateway;
  const whatsFeito = whatsConectado && conexao.gateway ? `Conectado via ${PROVS[conexao.gateway].curto}` : "Ainda não conectado";

  const nomeModelo = motor && modelo ? nomeDoModelo(motor.id, modelo, modelosDaLista) : "";
  const passos: readonly string[] = motor
    ? [
        `Falando ${comMotor}`,
        "Conferindo a chave",
        motor.busca || !nomeModelo ? "Testando o modelo escolhido" : `Testando o ${nomeModelo}`,
      ]
    : [];
  const outros = motor ? MOTORES.filter((m) => m.id !== motor.id) : [];

  const palco = motor ? (
    <PalcoValidacao
      fase={fase}
      faseAntes={val.faseAntes}
      logo={motor.logo}
      logoAlt={motor.nome}
      passos={passos}
      passo={val.passo}
      fusao={!!fusao}
      ok={
        <BlocoOk
          estado="Chave aceita"
          titulo="A Janete já tem cérebro."
          mono={false}
          detalhe={fraseOk}
          linha={
            <p className={cx(s.estadoLinha, s.sobe, s.d3)}>
              <Icone d={IC.cadeado} tamanho="p" />
              <span>A chave fica guardada com segurança e nunca é mostrada de novo.</span>
            </p>
          }
          extra={
            semEscuta ? (
              <p className={cx(s.aviso, s.avisoInfo, s.sobe, s.d3)}>
                <Icone d={IC.microfone} />
                <span>{AVISO_ANTHROPIC_SEM_ESCUTA}</span>
              </p>
            ) : undefined
          }
          acaoPrincipal="Próximo"
          aoPrincipal={proximoJanete}
          acaoSecundaria="Trocar chave"
          aoSecundaria={trocarChave}
        />
      }
      erro={
        erro
          ? {
              estado: estadoDoErro(erro.codigo),
              titulo: erro.titulo,
              texto: erro.texto,
              corrigirTexto: erro.semSessao ? "Entrar de novo" : corrigirDoErro(erro.codigo),
              aoCorrigir: corrigir,
              aoTentarDeNovo: validar,
            }
          : null
      }
    />
  ) : null;

  /** O campo da chave (antes da lista na Anthropic e na OpenAI; depois, no OpenRouter). */
  const campoChave = (m: Motor, aberto: boolean) => (
    <Campo
      id={idChave(m.id)}
      rotulo={`Chave de API d${m.artigo} ${m.nome}`}
      type={verChave ? "text" : "password"}
      onChange={(ev) => {
        setTamanhoChave(ev.target.value.trim().length);
        setErroChave(null);
        // a lista da Anthropic e da OpenAI é a da chave buscada: outra chave, outra busca
        if (!m.busca && lista.estado !== "vazia" && lista.estado !== "falhou") esquecerLista();
      }}
      onKeyDown={(ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        if (lista.estado === "pronta") {
          if (!bloqueado) validar();
        } else if (podeBuscar) buscarModelos();
      }}
      placeholder="Cole a chave aqui"
      autoComplete="off"
      spellCheck={false}
      style={{ fontFamily: "var(--sb-fonte-mono)" }}
      erro={aberto && erroChave ? erroChave : undefined}
      dica="Depois de validada, a chave fica guardada com segurança e nunca é mostrada de novo."
      sufixo={
        <button
          type="button"
          className={s.olhar}
          aria-label={verChave ? "Ocultar chave" : "Mostrar chave"}
          onClick={() => setVerChave((v) => !v)}
        >
          {verChave ? "Ocultar" : "Mostrar"}
        </button>
      }
    />
  );

  /** A lista de modelos do motor aberto, nos estados: à espera da chave, buscando, falhou e pronta. */
  const blocoModelos = (m: Motor, aberto: boolean): ReactNode => {
    const doM = `d${m.artigo} ${m.nome}`;
    const opcoes: OpcaoModelo[] = aberto ? opcoesDe(modelosDaLista, { busca: !!m.busca, termo: busca, atual: modelo }) : [];
    const visiveis = visiveisDe(opcoes, limite, modelo);
    const restantes = opcoes.length - visiveis.length;
    const temAtivo = visiveis.some((o) => o.id === modelo);
    const temPreco = visiveis.some((o) => o.preco);
    const teclaModelo = (i: number) => (ev: KeyboardEvent<HTMLButtonElement>) => {
      let d = 0;
      if (ev.key === "ArrowDown" || ev.key === "ArrowRight") d = 1;
      else if (ev.key === "ArrowUp" || ev.key === "ArrowLeft") d = -1;
      else return;
      ev.preventDefault();
      const j = (i + d + visiveis.length) % visiveis.length;
      const alvo = visiveis[j];
      if (!alvo) return;
      escolherModelo(alvo.id);
      focar(`md-${m.id}-${j}`);
    };
    const artigoMaiusculo = m.artigo.toUpperCase();
    return (
      <div className={s.campoModelo}>
        <p className={s.campoRotulo} id={`rotulo-modelo-${m.id}`}>
          Modelo
        </p>
        {m.busca && (
          <Campo
            id={`busca-${m.id}`}
            rotulo="Buscar modelo"
            rotuloOculto
            type="search"
            value={busca}
            onChange={(ev) => setBusca(ev.target.value)}
            placeholder="Buscar modelo, ex.: haiku"
            autoComplete="off"
            prefixo={<Icone d={IC.lupa} />}
          />
        )}
        {aberto && lista.estado === "vazia" && !m.busca && (
          <p className={s.ajuda}>Cole a chave e busque os modelos que ela libera. A busca já confere se a chave funciona.</p>
        )}
        {aberto && lista.estado === "buscando" && (
          <p className={cx(s.corpo2, s.consultando)} role="status">
            <Giro tamanho={16} />
            <span>Buscando os modelos {doM}…</span>
          </p>
        )}
        {aberto && lista.estado === "falhou" && <AvisoErro titulo={lista.titulo} texto={lista.texto} />}
        {aberto && lista.estado === "pronta" && (
          <>
            {lista.reserva && (
              <p className={cx(s.aviso, s.avisoInfo)} role="status">
                <Icone d={IC.alerta} />
                <span>
                  {artigoMaiusculo} {m.nome} não respondeu agora. Mostramos os modelos que recomendamos; para usar outro,
                  digite o id completo.
                </span>
              </p>
            )}
            <div
              className={cx(s.modelos, s.duasColunas)}
              data-colunas="2"
              role="radiogroup"
              aria-labelledby={`rotulo-modelo-${m.id}`}
            >
              {temPreco && (
                <p className={s.modelosCab} aria-hidden="true">
                  Preço em US$ por 1 milhão de tokens: entrada / saída
                </p>
              )}
              {visiveis.map((o, i) => {
                const ativo = modelo === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="radio"
                    id={`md-${m.id}-${i}`}
                    className={cx(s.modelo, ativo && s.ativo)}
                    aria-checked={ativo}
                    tabIndex={ativo || (!temAtivo && i === 0) ? 0 : -1}
                    onClick={() => escolherModelo(o.id)}
                    onKeyDown={teclaModelo(i)}
                  >
                    <span className={s.radio} aria-hidden="true" />
                    <span className={s.mdTexto}>
                      <span className={s.mdNome}>
                        <span className={o.digitado ? s.mdId : undefined}>{o.nome}</span>
                        {o.recomendado && <span className={s.selo}>Recomendado</span>}
                      </span>
                      {o.detalhe && <span className={cx(s.mdPerfil, o.detalheId && s.mdId)}>{o.detalhe}</span>}
                    </span>
                    {o.preco && (
                      <span className={s.mdPreco}>
                        <span className={s.sr}>Preço por 1 milhão de tokens, entrada e saída: </span>
                        <span>{o.preco}</span>
                      </span>
                    )}
                  </button>
                );
              })}
              {m.busca && opcoes.length === 0 && (
                <p className={s.buscaVazia}>
                  Nenhum modelo com “{curto(busca, 24)}”. Digite o id completo, como fabricante/modelo.
                </p>
              )}
              {!m.busca && opcoes.length === 0 && (
                <p className={s.buscaVazia}>A chave não libera nenhum modelo de texto. Confira a conta {doM}.</p>
              )}
            </div>
            {restantes > 0 && (
              <div className={s.maisModelos}>
                <span>
                  Mostrando {visiveis.length} de {opcoes.length} modelos.
                </span>
                <BotaoCompacto aoClicar={() => setLimite((l) => l + LIMITE_PASSO)}>Mostrar mais</BotaoCompacto>
              </div>
            )}
          </>
        )}
        {m.busca && <p className={s.ajuda}>Centenas de modelos com uma chave só.</p>}
      </div>
    );
  };

  /** O botão do pé do painel: "Buscar modelos" até a lista chegar (Anthropic e OpenAI), depois "Validar chave". */
  const botaoPe = (m: Motor, aberto: boolean) => {
    if (!m.busca && aberto && lista.estado === "falhou" && lista.semSessao) {
      return <Botao onClick={irParaEntrar}>Entrar de novo</Botao>;
    }
    if (!m.busca && (!aberto || lista.estado !== "pronta")) {
      return (
        <Botao
          id={`btn-buscar-${m.id}`}
          disabled={!aberto || !podeBuscar}
          onClick={buscarModelos}
          iconeDepois={<Icone d={IC.seta} />}
        >
          Buscar modelos
        </Botao>
      );
    }
    if (m.busca && aberto && lista.estado === "falhou" && lista.semSessao) {
      return <Botao onClick={irParaEntrar}>Entrar de novo</Botao>;
    }
    return (
      <Botao disabled={!aberto || bloqueado} onClick={validar} iconeDepois={<Icone d={IC.seta} />}>
        Validar chave
      </Botao>
    );
  };

  const cartao = (
    <CartaoLista
      etapa="cerebro"
      topo={<p className={s.olho}>O cérebro da Janete</p>}
      titulo="Escolha o cérebro da Janete"
      subtitulo="O modelo de IA que ela usa para entender e responder. Dá para trocar depois."
      fase={fase}
      validando={validando}
      entrada={entrada}
      saindo={saindo}
      preparando={val.preparando}
      palco={palco}
    >
      <div className={s.linhaResumo}>
        <span className={cx(s.feitoGlifo, whatsConectado && s.ok)} aria-hidden="true">
          <Icone d={whatsConectado ? IC.ok : IC.pendente} tamanho="p" />
        </span>
        <span className={s.linhaTexto}>
          <span className={s.meta}>WhatsApp</span>
          <span className={s.resumoNome}>{whatsFeito}</span>
        </span>
        <Botao variante="discreto" className={s.btnC} onClick={voltar}>
          {whatsConectado ? "Alterar" : "Conectar"}
        </Botao>
      </div>
      <Dobra aberta={!motorId}>
        <h2 className={cx(s.listaOlho, s.apos)}>Qual motor a Janete vai usar?</h2>
      </Dobra>
      <ul>
        {MOTORES.map((m) => {
          const aberto = motorId === m.id;
          return (
            <li key={m.id}>
              <Dobra aberta={!motorId}>
                <Linha
                  id={`linha-${m.id}`}
                  inicio={<LogoTile logo={m.logo} alt={m.nome} />}
                  nome={m.nome}
                  frase={m.linha}
                  aoEscolher={() => escolherMotor(m.id)}
                />
              </Dobra>
              <Dobra aberta={aberto}>
                {(aberto || painelMontado === m.id) && (
                  <div className={s.painel} role="group" aria-label={m.nome}>
                    <PainelCab inicio={<LogoTile logo={m.logo} alt={m.nome} />} nome={m.nome} frase={m.linha} aoVoltar={voltarMotor} />
                    {aberto && avisoIA && <AvisoErro titulo={avisoIA.titulo} texto={avisoIA.texto} />}
                    {m.busca ? blocoModelos(m, aberto) : campoChave(m, aberto)}
                    {m.id === "anthropic" && aberto && pedeWorkspace && (
                      <Campo
                        id="workspace-anthropic"
                        rotulo="ID do workspace"
                        value={workspace}
                        onChange={(ev) => {
                          setWorkspace(ev.target.value);
                          setErroWorkspace(null);
                          if (lista.estado !== "vazia" && lista.estado !== "falhou") esquecerLista();
                        }}
                        onKeyDown={(ev) => {
                          if (ev.key !== "Enter") return;
                          ev.preventDefault();
                          if (lista.estado === "pronta") {
                            if (!bloqueado) validar();
                          } else if (podeBuscar) buscarModelos();
                        }}
                        placeholder="wrkspc_…"
                        autoComplete="off"
                        spellCheck={false}
                        dica="Começa com wrkspc_."
                        erro={erroWorkspace ?? undefined}
                      />
                    )}
                    {m.busca ? campoChave(m, aberto) : blocoModelos(m, aberto)}
                    {m.id === "anthropic" && aberto && semEscuta && (
                      <p className={cx(s.aviso, s.avisoInfo)}>
                        <Icone d={IC.microfone} />
                        <span>{AVISO_ANTHROPIC_SEM_ESCUTA}</span>
                      </p>
                    )}
                    <div className={s.painelPe}>{botaoPe(m, aberto)}</div>
                  </div>
                )}
              </Dobra>
            </li>
          );
        })}
      </ul>
      <OutrosRodape
        aberta={!!motor}
        logos={outros.map((o) => ({ logo: o.logo, alt: o.nome }))}
        texto={outros.length ? `Outros motores: ${juntar(outros.map((o) => o.nome))}` : ""}
        aoVerTodos={voltarMotor}
      />
    </CartaoLista>
  );

  return (
    <>
      {cartao}
      {fusao && motor && <FusaoJanete logo={{ src: motor.logo, alt: motor.nome }} origem={fusao} aoTerminar={terminarFusao} />}
    </>
  );
}
