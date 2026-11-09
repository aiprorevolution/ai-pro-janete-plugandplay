import { useEffect, useRef, useState } from "react";

import { Botao, Campo, Selo, cx } from "@/components/aipro";
import { movimentoReduzido, rolarAteEMedir, useVooJanete } from "@/components/janete/VooJanete";
import type { AvisoConexao, ResultadoSalvarConexao } from "@/features/mensageria/configuracao.functions";
import type { PropsEtapa } from "@/features/onboarding/Onboarding";
import { useOnboarding, type Gateway, type ModoConexao } from "@/features/onboarding/estado";
import { useJaneteNoPalco, usePalco } from "@/features/onboarding/palco";
import { useDadosOnboarding } from "@/features/plataforma/dados/onboarding";
import { formatarNumero, normalizarNumero } from "@/features/servidor/numero-whatsapp";
import { ehGatewayQr, type GatewayQr, type PedidoQr } from "@/features/servidor/qr-conexao";

import {
  AvisoErro,
  BlocoOk,
  CartaoLista,
  Dobra,
  FASES_PALCO,
  GIRO_WHATSAPP_MS,
  IC,
  Icone,
  LOGO,
  Linha,
  LogoTile,
  MENSAGEM_SEM_RESPOSTA,
  MENSAGEM_SEM_SESSAO,
  MODOS,
  mensagemDoResultado,
  ORDEM_PROVS,
  OutrosRodape,
  PROVS,
  PainelCab,
  PalcoValidacao,
  DIFICULDADE,
  camposLargos,
  focarAgora,
  irParaEntrar,
  juntar,
  lerCampo,
  limparCampo,
  pedirDesdobra,
  provsDoModo,
  s,
  separarMensagem,
  sessaoTerminou,
  useDepois,
  usePainelMontado,
  useValidacao,
  type Desfecho,
  type EntradaCartao,
  type Fase,
  type Gerado,
  type Provedor,
} from "../lista";
import { PassoQr, tempoVoltaDisco } from "./qr/PassoQr";
import { useLeituraQr, type RespostaQr } from "./qr/useLeituraQr";

/** O erro que a função devolveu, como a tela mostra (título = 1ª frase, texto = o resto). */
interface ErroConexaoTela {
  titulo: string;
  texto: string;
  /** Campo marcado (aria-invalid) e para onde "Corrigir os dados" leva o foco. */
  campo: string | null;
  /** A chamada foi recusada porque a sessão terminou: a ação leva para o login. */
  semSessao?: boolean;
}

/**
 * O que o "Conectar" gravou e a tela mostra no quadro de sucesso: o endereço do webhook e, na Meta,
 * o verify token (decisão 14b), e os avisos (feito na prévia, decisão 14c; webhook não configurado).
 * Só desta visita: depois de recarregar, os dois ficam em Configuração.
 */
interface SucessoConexao {
  gateway: Gateway;
  url: string;
  verifyToken: string | null;
  avisos: readonly AvisoConexao[];
}

/** O aviso da prévia (decisão 14c): o webhook gravado aponta para o endereço da prévia. */
export const AVISO_PREVIA =
  "Você está na prévia. Depois de publicar o app, salve a conexão de novo em Configuração, para as mensagens chegarem ao endereço publicado.";

/**
 * O número que falta ler o QR code (Z-API e Evolution desconectadas): o gateway e os campos lidos
 * no "Conectar". Só num ref, apagado no sucesso, em qualquer outro resultado, no "Corrigir os
 * dados" e ao desmontar (spec-qr-whatsapp, premissas).
 */
interface AlvoQr {
  gateway: GatewayQr;
  campos: Record<string, string>;
}

/** O anúncio ao entrar no passo do QR; o resto (expirado, passkey, erro) a linha viva do PassoQr anuncia. */
const ANUNCIO_QR = "Falta ler o QR code com o WhatsApp do celular.";

/** O anúncio ao entrar no "celular de outro número" (spec-qr-whatsapp, seção 8, decisão 2). */
const ANUNCIO_DIFERENTE = "O celular conectado é de outro número.";

/** O celular que leu o QR é de outro número: os dois já vêm formatados ("+55 11 98765-4321"). */
interface NumeroDiferente {
  conectado: string;
  informado: string;
}

/** Que campos já têm valor (o valor em si fica só no `<input>`, não no estado; ver campos.ts). */
type Preenchidos = Partial<Record<Gateway, Record<string, boolean>>>;

function completos(p: Provedor, preenchidos: Record<string, boolean> | undefined): boolean {
  return p.campos.every((c) => c.opcional || !!preenchidos?.[c.id]);
}

const idCampo = (gateway: Gateway, campo: string) => `f-${gateway}-${campo}`;

/** O número informado no alvo do QR, formatado para o passo 1; sem número válido, nada. */
function numeroDoAlvo(alvo: AlvoQr | null): string | undefined {
  const informado = alvo?.campos["numero"];
  const digitos = informado ? normalizarNumero(informado) : null;
  return digitos ? formatarNumero(digitos) : undefined;
}

/** Em 2 colunas, os campos de cada gateway que ocupam a linha inteira (ver camposLargos). */
const LARGOS = Object.fromEntries(ORDEM_PROVS.map((g) => [g, camposLargos(PROVS[g].campos)])) as Record<Gateway, Set<string>>;

/** Apaga do DOM as credenciais digitadas num gateway (ou em todos). */
function limparCredenciais(gateways: readonly Gateway[]) {
  for (const g of gateways) for (const c of PROVS[g].campos) limparCampo(idCampo(g, c.id));
}

/** Foco perdido: no body, ou num elemento que ficou inert (a linha clicada, dentro da dobra fechada). */
function focoPerdido(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement;
  return !el || el === document.body || !!el.closest("[inert]");
}

/**
 * Etapa 1 · WhatsApp (seção "1 e 2 · A lista" do F). Escolhe o modo, o provedor e cola as
 * credenciais; "Conectar" testa de verdade no gateway e grava a conexão (salvarConexao, no servidor).
 * Do sucesso fica só o `rotulo` no estado; as credenciais somem da memória do componente. Elas
 * ficam só nos `<input>` (não controlados): o estado guarda apenas se cada campo está preenchido.
 */
export function EtapaConexao({ avancar }: PropsEtapa) {
  const { estado, definirConexao } = useOnboarding();
  const dados = useDadosOnboarding();
  const voo = useVooJanete();
  const vooRef = useRef(voo);
  vooRef.current = voo;
  const { anunciar } = usePalco();
  const { depois, focar } = useDepois();

  // o estado gravado vale para a primeira pintura (a rota não renderiza no servidor)
  const inicial = useRef(estado.conexao).current;
  const jaConectado = !!inicial.rotulo && !!inicial.gateway;
  const [modo, setModo] = useState<ModoConexao | null>(inicial.modo);
  const [prov, setProv] = useState<Gateway | null>(inicial.gateway);
  const [rotulo, setRotulo] = useState<string | null>(jaConectado ? inicial.rotulo : null);
  const [preenchidos, setPreenchidos] = useState<Preenchidos>({});
  const [revelar, setRevelar] = useState<Record<string, boolean>>({});
  const [erro, setErro] = useState<ErroConexaoTela | null>(null);
  const [campoErro, setCampoErro] = useState<string | null>(null);
  const [avisoW, setAvisoW] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<SucessoConexao | null>(null);
  const val = useValidacao(GIRO_WHATSAPP_MS, jaConectado ? "ok" : "form");
  const fase = val.fase;
  // o alvo do passo do QR (os campos colados ficam só aqui e nos <input>, nunca no estado)
  const alvoQr = useRef<AlvoQr | null>(null);
  // o celular de outro número leu o QR (seção 8): os números, o "Desconectar" em curso e a falha dele
  const [diferente, setDiferente] = useState<NumeroDiferente | null>(null);
  const [desconectando, setDesconectando] = useState(false);
  const [erroDiferente, setErroDiferente] = useState<string | null>(null);
  // cada "Desconectar" tem a sua rodada: sair do passo (ou desmontar) invalida a resposta que chegar depois
  const rodadaDesconectar = useRef(0);
  // depois do "conectado", o quadro encolhe de volta no círculo antes de o "Conectar" salvar
  const voltaDisco = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pararVoltaDisco = () => {
    if (voltaDisco.current !== null) clearTimeout(voltaDisco.current);
    voltaDisco.current = null;
  };
  const limparDiferente = () => {
    rodadaDesconectar.current += 1;
    setDiferente(null);
    setDesconectando(false);
    setErroDiferente(null);
  };
  // o celular na instância leu o QR desta tela (o "Conectar" achou a instância desconectada, ou o
  // "Desconectar" tirou o anterior): só ele sai sozinho quando a pessoa deixa o aviso do outro número
  // sem escolher. Uma instância que já estava conectada antes não cai.
  const lidoAqui = useRef(false);
  // o desconectar em curso (o do botão ou o da saída): o próximo "Conectar" espera ele terminar, para
  // não achar a instância ainda com o celular errado. Sem nenhum em curso, o "Conectar" chama na hora.
  const soltando = useRef<Promise<void> | null>(null);
  const guardarSoltando = (pedido: Promise<unknown>) => {
    const fim: Promise<void> = pedido.then(
      () => {
        if (soltando.current === fim) soltando.current = null;
      },
      () => {
        if (soltando.current === fim) soltando.current = null;
      },
    );
    soltando.current = fim;
  };
  // sair do aviso do outro número sem escolher ("Corrigir os dados" ou sair da etapa) tira o celular
  // errado da instância (seção 8, decisão 5), sem esperar nem mostrar a resposta: a pessoa já saiu.
  // Nenhuma falha escapa, nem a síncrona: ela não pode cortar a saída no meio.
  const soltarCelularErrado = () => {
    const alvo = alvoQr.current;
    // só com o aviso na tela: depois do "Usar o …", o salvar já saiu com esse celular
    if (fase !== "qr" || !alvo || !diferente || desconectando || !lidoAqui.current) return;
    lidoAqui.current = false;
    guardarSoltando(
      new Promise((resolver) =>
        resolver(dados.desconectarCelular({ gateway: alvo.gateway, campos: alvo.campos })),
      ),
    );
  };
  const soltarRef = useRef(soltarCelularErrado);
  soltarRef.current = soltarCelularErrado;
  useEffect(
    () => () => {
      soltarRef.current();
      alvoQr.current = null;
      rodadaDesconectar.current += 1;
      if (voltaDisco.current !== null) clearTimeout(voltaDisco.current);
      voltaDisco.current = null;
    },
    [],
  );
  useEffect(() => {
    if (fase !== "qr" && voltaDisco.current !== null) {
      clearTimeout(voltaDisco.current);
      voltaDisco.current = null;
    }
  }, [fase]);

  // chegada do login: o cartão espera invisível (mas medido) o símbolo pousar no topo dele
  const chegouVoando = useRef(voo.ativo).current;
  const [entrada, setEntrada] = useState<EntradaCartao>(() => (chegouVoando && !movimentoReduzido() ? "espera" : null));
  const painelMontado = usePainelMontado(prov);

  // o provedor aberto agora (as respostas assíncronas conferem se ele ainda é o mesmo)
  const provRef = useRef(prov);
  provRef.current = prov;

  const p = prov ? PROVS[prov] : null;
  const validando = FASES_PALCO.includes(fase) && !!p;
  // na chegada do login o cartão nasce do símbolo: a marca da barra só volta no fim da passagem
  useJaneteNoPalco(validando || entrada !== null);

  /* ---------- chegada do login (subirConexao do F) ---------- */
  useEffect(() => {
    if (!chegouVoando) {
      // sem voo (movimento reduzido no criar conta, link direto): como o F, o foco vai para a
      // primeira opção, a não ser que já esteja em outro lugar (a casca focou o título da etapa)
      if (!jaConectado && !inicial.modo && !inicial.gateway) {
        depois(() => {
          if (focoPerdido()) focarAgora("linha-modo-oficial");
        }, 60);
      }
      return;
    }
    const v = vooRef.current;
    if (movimentoReduzido()) {
      v.soltar();
      focar("linha-modo-oficial");
      return;
    }
    const ts: Array<ReturnType<typeof setTimeout>> = [];
    let vivo = true;
    // o cartão nasce do símbolo: 180 ms depois de o voo chegar, e a entrada termina 780 ms depois
    const nascer = (aposMs: number) => {
      ts.push(
        setTimeout(() => {
          setEntrada("nascendo");
          vooRef.current.soltar({ desvanecer: true });
        }, aposMs),
      );
      ts.push(
        setTimeout(() => {
          setEntrada(null);
          focarAgora("linha-modo-oficial");
        }, aposMs + 780),
      );
    };
    ts.push(
      setTimeout(() => {
        // o alvo é o círculo de onde o cartão nasce (#nasce-mira, centro a TOPO_NASCE do topo do
        // cartão); mede só depois de a página parar de rolar, para o símbolo não pousar fora dele
        void rolarAteEMedir("nasce-mira").then((ponto) => {
          if (!vivo) return;
          if (!ponto) {
            nascer(0);
            return;
          }
          void vooRef.current.voar({ ...ponto, tamanho: 96 }, { duracaoMs: 900 });
          ts.push(setTimeout(() => vooRef.current.legenda(null), 900));
          nascer(1080);
        });
      }, 60),
    );
    return () => {
      vivo = false;
      ts.forEach(clearTimeout);
    };
    // só na montagem
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chegouVoando, focar]);

  /* ---------- foco depois de cada transição (componentDidUpdate do F) ---------- */
  // ao entrar no passo do QR (ou no "outro número"): anuncia, foca o título e rola o passo inteiro
  // (o pé, com a linha viva e os botões, entra na vista em 1440×900, e o título continua visível:
  // o "nearest" alinha o topo quando o passo é mais alto que a tela)
  const entrarNoPasso = (anuncio: string) => {
    anunciar(anuncio);
    focar("qr-titulo");
    depois(() => {
      const el = document.getElementById("qr-titulo-passo");
      if (el && typeof el.scrollIntoView === "function")
        el.scrollIntoView({ block: "nearest", behavior: movimentoReduzido() ? "auto" : "smooth" });
    }, 60);
  };

  // o "outro número" anunciado: só uma vez por entrada (com a fase já em "qr")
  const diferenteAnunciado = useRef(false);
  useEffect(() => {
    const agora = !!diferente && fase === "qr";
    if (agora && !diferenteAnunciado.current) entrarNoPasso(ANUNCIO_DIFERENTE);
    diferenteAnunciado.current = agora;
    // só a entrada no "outro número" dispara o anúncio
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diferente, fase]);

  const faseAnterior = useRef<Fase>(fase);
  useEffect(() => {
    const antes = faseAnterior.current;
    faseAnterior.current = fase;
    if (antes === fase) return;
    if (fase === "ok" || fase === "erro") {
      focar("val-pri", { rolar: true });
      return;
    }
    if (fase === "qr") {
      // o anúncio sai uma vez por entrada no passo (aqui, na troca de fase); o do celular de outro
      // número sai no efeito do `diferente`, logo abaixo
      if (!diferente) entrarNoPasso(ANUNCIO_QR);
      return;
    }
    // com movimento reduzido, o reabrir vai do "qr" direto para o "form", sem o "reabrindo"
    if (fase === "form" && (antes === "reabrindo" || antes === "ok" || antes === "erro" || antes === "qr")) {
      if (!prov) return focar("lista-cartao", { rolar: true });
      const pr = PROVS[prov];
      const vazio = pr.campos.find((c) => !preenchidos[prov]?.[c.id]);
      const alvo = campoErro ?? (completos(pr, preenchidos[prov]) ? null : (vazio?.id ?? null));
      focar(alvo ? `f-${prov}-${alvo}` : `btn-conectar-${prov}`, { rolar: true });
    }
    // só a troca de fase dispara o foco
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fase]);

  // voltou de "Alterar" no cérebro (ou recomeçou com a conexão gravada): o foco vai para a ação do resultado
  useEffect(() => {
    if (jaConectado) focar("val-pri");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- anúncios para o leitor de tela ---------- */
  useEffect(() => {
    if (!p) return;
    if (fase === "verificando") anunciar(`Verificando a conexão. ${p.passos[Math.min(val.passo, 2)] ?? ""}…`);
    else if (fase === "ok" && rotulo) anunciar(`WhatsApp conectado. ${rotulo}`);
    else if (fase === "erro" && erro) anunciar(`Não conectou. ${erro.titulo}`);
  }, [anunciar, erro, fase, p, rotulo, val.passo]);

  /* ---------- escolhas (E3) ---------- */
  const mov = () => !movimentoReduzido();

  // durante o preparo da validação (a página rolando até o disco) modo e provedor não mudam
  const escolherModo = (id: ModoConexao) => {
    if (fase !== "form" || val.preparando) return;
    setModo(id);
    setProv(null);
    setCampoErro(null);
    setAvisoW(false);
    definirConexao({ modo: id, gateway: null, rotulo: null });
    focar("olho-prov");
  };

  const trocarModo = () => {
    if (fase !== "form" || val.preparando) return;
    const antes = modo;
    // as credenciais digitadas no modo abandonado não ficam para trás
    limparCredenciais(ORDEM_PROVS);
    setPreenchidos({});
    setRevelar({});
    setModo(null);
    setProv(null);
    setCampoErro(null);
    setAvisoW(false);
    definirConexao({ modo: null, gateway: null, rotulo: null });
    if (antes) focar(`linha-modo-${antes}`);
  };

  const escolherProv = (id: Gateway) => {
    if (fase !== "form" || val.preparando) return;
    setProv(id);
    setCampoErro(null);
    setAvisoW(false);
    definirConexao({ gateway: id, rotulo: null });
    const pr = PROVS[id];
    const primeiro = pr.campos[0];
    focar(primeiro ? `f-${id}-${primeiro.id}` : `btn-conectar-${id}`, { atrasoMs: mov() ? 380 : 0 });
  };

  const voltarProv = () => {
    if (fase !== "form" || val.preparando) return;
    const antes = prov;
    // as credenciais do gateway abandonado não ficam para trás (reabrir mostra o painel vazio)
    if (antes) {
      limparCredenciais([antes]);
      setPreenchidos((atual) => ({ ...atual, [antes]: {} }));
    }
    setRevelar({});
    setProv(null);
    setCampoErro(null);
    setAvisoW(false);
    definirConexao({ gateway: null, rotulo: null });
    if (antes) focar(`linha-${antes}`, { atrasoMs: mov() ? 380 : 0 });
  };

  const mudarCampo = (gateway: Gateway, campo: string, valor: string) => {
    const tem = valor.trim().length > 0;
    setPreenchidos((atual) =>
      atual[gateway]?.[campo] === tem ? atual : { ...atual, [gateway]: { ...(atual[gateway] ?? {}), [campo]: tem } },
    );
    setCampoErro((atual) => (atual === campo ? null : atual));
  };

  /* ---------- validação (E4) ---------- */
  // "Conectar" testa no gateway e grava a conexão de uma vez (salvarConexao, só admin).
  const conectar = () => {
    if (!prov || !p) return;
    if (!completos(p, preenchidos[prov])) return;
    const enviados: Record<string, string> = {};
    for (const c of p.campos) {
      const v = lerCampo(idCampo(prov, c.id)).trim();
      if (v) enviados[c.id] = v;
    }
    const gateway = prov;
    // do passo do QR (o celular leu, ou o "Usar o …") ou do "Tentar de novo" depois de uma falha: a
    // mesma instância da tentativa anterior, e o celular que leu o QR desta tela continua valendo
    const mesmosDados = fase === "qr" || fase === "erro";
    setCampoErro(null);
    setAvisoW(false);
    setCopiado(null);
    setSucesso(null);
    val.validar<ResultadoSalvarConexao>({
      // um desconectar em curso termina antes: a instância ainda teria o celular errado
      chamar: () => {
        const antes = soltando.current;
        const salvar = () => dados.salvarConexao({ gateway, campos: enviados });
        return antes ? antes.then(salvar) : salvar();
      },
      concluir: (d: Desfecho<ResultadoSalvarConexao>) => {
        // os campos do passo anterior saem da memória; só o QR que ainda falta ler guarda de novo
        alvoQr.current = null;
        // o "outro número" de antes sai em qualquer resultado; só volta se o celular ainda for outro
        limparDiferente();
        const lidoAntes = lidoAqui.current;
        lidoAqui.current = false;
        if (d.tipo === "resposta" && !d.valor.ok && d.valor.erro === "instancia_desconectada" && ehGatewayQr(gateway)) {
          alvoQr.current = { gateway, campos: enviados };
          // quem conectar daqui em diante lê o QR desta tela
          lidoAqui.current = true;
          setErro(null);
          return "qr";
        }
        // o celular conectado é de outro número (seção 8): o passo do QR mostra os dois e as saídas
        if (d.tipo === "resposta" && !d.valor.ok && d.valor.erro === "numero_diferente" && ehGatewayQr(gateway)) {
          alvoQr.current = { gateway, campos: enviados };
          // veio direto do "Conectar" (a instância já estava conectada): sair do aviso não desconecta
          lidoAqui.current = mesmosDados && lidoAntes;
          setDiferente({ conectado: d.valor.numero_conectado, informado: d.valor.numero_informado });
          setErro(null);
          return "qr";
        }
        if (d.tipo === "resposta" && d.valor.ok) {
          const r = d.valor;
          setRotulo(r.nome);
          setSucesso({ gateway, url: r.url_webhook, verifyToken: r.verifyToken ?? null, avisos: r.avisos });
          definirConexao({ modo: PROVS[gateway].modo, gateway, rotulo: r.nome });
          // sucesso: as credenciais saem da tela e da memória do componente (de todos os gateways,
          // inclusive os abandonados por "Voltar")
          limparCredenciais(ORDEM_PROVS);
          setPreenchidos({});
          setRevelar({});
          setErro(null);
          return "ok";
        }
        // a falha no meio não apaga quem leu o QR desta tela: o "Tentar de novo" usa os mesmos dados
        lidoAqui.current = mesmosDados && lidoAntes;
        if (d.tipo === "sem_sessao") {
          setErro({ ...separarMensagem(MENSAGEM_SEM_SESSAO), campo: null, semSessao: true });
          return "erro";
        }
        const mensagem = d.tipo === "resposta" && !d.valor.ok ? mensagemDoResultado(d.valor) : MENSAGEM_SEM_RESPOSTA;
        const campo = d.tipo === "resposta" && !d.valor.ok && "campo" in d.valor ? (d.valor.campo ?? null) : null;
        const existe = campo && PROVS[gateway].campos.some((c) => c.id === campo) ? campo : null;
        setErro({ ...separarMensagem(mensagem), campo: existe });
        return "erro";
      },
    });
  };

  const corrigir = () => {
    // de volta ao formulário, os dados podem mudar: o próximo "Conectar" recomeça a conta
    lidoAqui.current = false;
    if (erro?.semSessao) {
      irParaEntrar();
      return;
    }
    const alvo = erro?.campo ?? null;
    val.reabrir(() => {
      setCampoErro(alvo);
      setAvisoW(true);
    });
  };

  // do passo do QR de volta aos campos, ainda preenchidos; o foco vai ao vazio ou ao "Conectar"
  const corrigirDoQr = () => {
    soltarCelularErrado();
    lidoAqui.current = false;
    // um "Desconectar" em curso não mexe mais na tela; o aviso do outro número some com o palco
    rodadaDesconectar.current += 1;
    val.reabrir(() => {
      alvoQr.current = null;
      limparDiferente();
      setCampoErro(null);
      setAvisoW(false);
    });
  };

  /* ---------- passo do QR (Z-API e Evolution) ---------- */
  // traduz o resultado do servidor para o formato do useLeituraQr; a rejeição sobe (o hook trata)
  const pedirQr = async (pedido: PedidoQr): Promise<RespostaQr> => {
    const alvo = alvoQr.current;
    if (!alvo) throw new Error("Sem dados para pedir o QR code.");
    const r = await dados.pedirQr({ gateway: alvo.gateway, campos: alvo.campos, pedir: pedido });
    if (r.ok) {
      return r.conectado
        ? { ok: true, conectado: true, qr: null, passkey: false }
        : { ok: true, conectado: false, qr: r.qr, passkey: r.passkey };
    }
    if (r.erro === "sem_acesso") return { ok: false, erro: r.erro };
    return { ok: false, erro: r.erro, mensagem: r.mensagem, ...(r.campo ? { campo: r.campo } : {}) };
  };
  // o celular leu: o quadro encolhe de volta no círculo (tempoVoltaDisco) e então o "Conectar" lê
  // os campos de novo, grava e sai do "qr" direto para o giro. Com o celular de outro número, a
  // leitura para: a instância já está conectada, e a consulta chamaria o aoConectar de novo.
  const aoConectarQr = () => {
    pararVoltaDisco();
    const espera = tempoVoltaDisco();
    if (espera <= 0) {
      conectar();
      return;
    }
    voltaDisco.current = setTimeout(() => {
      voltaDisco.current = null;
      conectar();
    }, espera);
  };
  const leitura = useLeituraQr({ ativo: fase === "qr" && !diferente, pedir: pedirQr, aoConectar: aoConectarQr });

  // "Usar o +55 …": o número conectado vai para o campo do número, e o "Conectar" lê os campos de
  // novo e salva com ele (o servidor confere outra vez)
  const usarConectado = () => {
    if (!diferente || !prov || desconectando) return;
    const el = document.getElementById(idCampo(prov, "numero"));
    if (el instanceof HTMLInputElement) el.value = diferente.conectado;
    conectar();
  };

  // "Desconectar e ler de novo": tira o celular da instância (sem apagar a instância) e volta a
  // pedir o QR, para o celular do número informado ler
  const desconectarDiferente = () => {
    const alvo = alvoQr.current;
    if (!alvo || !diferente || desconectando) return;
    const rodada = ++rodadaDesconectar.current;
    setDesconectando(true);
    setErroDiferente(null);
    const vale = () => rodada === rodadaDesconectar.current;
    // o mesmo caminho da sessão encerrada: o palco do erro, com "Entrar de novo"
    const semSessao = () => {
      alvoQr.current = null;
      limparDiferente();
      setErro({ ...separarMensagem(MENSAGEM_SEM_SESSAO), campo: null, semSessao: true });
      val.definirFase("erro");
    };
    // a falha fica na linha anunciada, e o foco volta ao botão (o disabled do "Desconectando…"
    // tirou o foco dele, que cairia no body)
    const falhou = (mensagem: string) => {
      setDesconectando(false);
      setErroDiferente(mensagem);
      focar("qr-titulo-desconectar");
    };
    const pedido = dados.desconectarCelular({ gateway: alvo.gateway, campos: alvo.campos });
    // o próximo "Conectar" espera este desconectar, mesmo que a pessoa saia do aviso antes da resposta
    guardarSoltando(pedido);
    void pedido.then(
      (r) => {
        if (!vale()) return;
        if (r.ok) {
          // a leitura volta sozinha (o `ativo` liga de novo) e pede um QR novo; quem conectar agora
          // lê o QR desta tela
          lidoAqui.current = true;
          setDesconectando(false);
          setDiferente(null);
          setErroDiferente(null);
          focar("qr-titulo");
          return;
        }
        if (r.erro === "sem_acesso") {
          semSessao();
          return;
        }
        falhou(mensagemDoResultado(r));
      },
      async () => {
        // a chamada rejeitou: pode ser a sessão que acabou (como no useValidacao e no useLeituraQr)
        const acabou = await sessaoTerminou();
        if (!vale()) return;
        if (acabou) {
          semSessao();
          return;
        }
        falhou(MENSAGEM_SEM_RESPOSTA);
      },
    );
  };

  const trocarConexao = () => {
    rodadaDesconectar.current += 1;
    val.reabrir(() => {
      limparDiferente();
      setCampoErro(null);
      setAvisoW(false);
      setRotulo(null);
      setSucesso(null);
      definirConexao({ rotulo: null });
    });
  };

  // o check do WhatsApp se desdobra no contêiner do cérebro (E3)
  const irCerebro = () => {
    if (mov()) pedirDesdobra();
    avancar();
  };

  // "Copiado" só quando o navegador confirma a cópia. Sem área de transferência, ou com a cópia
  // recusada, o valor continua na tela para copiar à mão.
  const copiar = (id: string, valor: string, rotulo: string) => {
    let copia: Promise<void> | undefined;
    try {
      copia = navigator.clipboard?.writeText(valor);
    } catch {
      copia = undefined;
    }
    if (!copia) return;
    void copia.then(
      () => {
        setCopiado(id);
        // o aria-label do botão focado muda, mas o leitor de tela não anuncia: a região da casca anuncia
        anunciar(`${rotulo} copiada.`);
        depois(() => setCopiado((atual) => (atual === id ? null : atual)), 1600);
      },
      () => {},
    );
  };

  /* ---------- tela ---------- */
  const modoObj = MODOS.find((m) => m.id === modo) ?? null;
  const mostrarProvs = !!modo && !prov;
  const outros = p ? provsDoModo(p.modo).filter((id) => id !== p.id) : [];
  const desteGateway = sucesso && sucesso.gateway === prov ? sucesso : null;

  // O quadro de sucesso: na Meta, o endereço e o token para colar (decisão 14b); nos outros, o
  // endereço só quando o gateway não aceitou a configuração automática; e o aviso da prévia (14c).
  const linhaOk = (
    <>
      <p className={cx(s.okSub, s.sobe, s.d3)}>A Janete já pode receber as mensagens que chegarem neste número.</p>
      {desteGateway?.verifyToken ? (
        <FaltaUmPasso
          titulo="Falta 1 passo: cole no painel da Meta"
          texto="No app da Meta, em WhatsApp > Configuração, cole os dois no Webhook e assine o campo messages."
          valores={[
            { id: "ok-url", rotulo: "URL do webhook", valor: desteGateway.url },
            { id: "ok-verify", rotulo: "Verify token", valor: desteGateway.verifyToken },
          ]}
          copiado={copiado}
          aoCopiar={copiar}
        />
      ) : desteGateway?.avisos.includes("webhook_nao_configurado") ? (
        <FaltaUmPasso
          titulo={`Falta 1 passo: cole no painel da ${PROVS[desteGateway.gateway].curto}`}
          texto="Não conseguimos configurar o webhook sozinhos. Cole este endereço no campo do webhook."
          valores={[{ id: "ok-url", rotulo: "URL do webhook", valor: desteGateway.url }]}
          copiado={copiado}
          aoCopiar={copiar}
        />
      ) : !desteGateway && prov === "meta" ? (
        <p className={cx(s.okSub, s.sobe, s.d3)}>O endereço e o token do webhook ficam em Configuração.</p>
      ) : null}
      {desteGateway?.avisos.includes("url_de_previa") ? (
        <p className={cx(s.aviso, s.avisoInfo, s.sobe, s.d3)} role="note">
          <Icone d={IC.alerta} />
          <span>{AVISO_PREVIA}</span>
        </p>
      ) : null}
    </>
  );

  const palco = p ? (
    <PalcoValidacao
      fase={fase}
      faseAntes={val.faseAntes}
      logo={p.logo}
      logoAlt={p.logoAlt}
      escura={p.escura}
      larga={p.larga}
      passos={p.passos}
      passo={val.passo}
      ok={
        <BlocoOk
          estado="Conectado"
          titulo="Tudo certo, WhatsApp conectado."
          detalhe={rotulo ?? ""}
          linha={linhaOk}
          acaoPrincipal="Escolher o cérebro"
          aoPrincipal={irCerebro}
          acaoSecundaria="Trocar conexão"
          aoSecundaria={trocarConexao}
        />
      }
      qr={
        alvoQr.current && prov ? (
          <PassoQr
            variante="palco"
            idTitulo="qr-titulo"
            gateway={alvoQr.current.gateway}
            estado={leitura.estado}
            numero={numeroDoAlvo(alvoQr.current)}
            diferente={
              diferente
                ? {
                    conectado: diferente.conectado,
                    informado: diferente.informado,
                    aoUsar: usarConectado,
                    aoDesconectar: desconectarDiferente,
                    desconectando,
                    erro: erroDiferente,
                  }
                : undefined
            }
            aoGerarOutro={leitura.gerarOutro}
            acoes={
              <Botao variante="contorno" onClick={corrigirDoQr}>
                Corrigir os dados
              </Botao>
            }
            aoEntrarDeNovo={irParaEntrar}
          />
        ) : undefined
      }
      erro={
        erro
          ? {
              estado: "Não conectou",
              titulo: erro.titulo,
              texto: erro.texto,
              corrigirTexto: erro.semSessao ? "Entrar de novo" : erro.campo ? "Corrigir os dados" : "Voltar",
              aoCorrigir: corrigir,
              aoTentarDeNovo: conectar,
            }
          : null
      }
    />
  ) : null;

  return (
    <CartaoLista
      etapa="conexao"
      topo={
        <span className={s.seloWa}>
          <img src={LOGO.whatsapp} alt="" />
          WhatsApp
        </span>
      }
      titulo="Conecte o WhatsApp da empresa"
      subtitulo="É por este número que a Janete vai conversar com os seus leads."
      fase={fase}
      validando={validando}
      entrada={entrada}
      preparando={val.preparando}
      palco={palco}
    >
      <Dobra aberta={!modo}>
        <h2 className={s.listaOlho}>Como você quer conectar?</h2>
      </Dobra>
      <ul>
        {MODOS.map((m) => (
          <Dobra key={m.id} as="li" aberta={!modo}>
            <Linha
              id={`linha-modo-${m.id}`}
              inicio={
                <span className={s.linhaIcone} aria-hidden="true">
                  <Icone d={m.icone} tamanho="g" />
                </span>
              }
              nome={m.titulo}
              frase={m.linha}
              extra={
                <span className={s.estadoLinha} data-tom={m.estadoClasse}>
                  <Icone d={m.estadoIcone} tamanho="p" />
                  <span>{m.selo}</span>
                </span>
              }
              aoEscolher={() => escolherModo(m.id)}
            />
          </Dobra>
        ))}
      </ul>
      <Dobra aberta={!!modoObj}>
        <div className={s.linhaResumo}>
          <span className={cx(s.linhaIcone, s.p)} aria-hidden="true">
            <Icone d={modoObj?.icone ?? ""} />
          </span>
          <span className={s.linhaTexto}>
            <span className={s.meta}>Modo de conexão</span>
            <span className={s.resumoNome}>{modoObj?.resumo ?? ""}</span>
          </span>
          <Botao variante="discreto" className={s.btnC} onClick={trocarModo} icone={<Icone d={IC.chevronEsquerda} tamanho="p" />}>
            Trocar modo
          </Botao>
        </div>
      </Dobra>
      <Dobra aberta={mostrarProvs}>
        <h2 id="olho-prov" className={cx(s.listaOlho, s.apos)} tabIndex={-1}>
          {modo === "naooficial" ? "Escolha o provedor não oficial" : "Escolha o provedor oficial"}
        </h2>
      </Dobra>
      <ul>
        {ORDEM_PROVS.map((id) => {
          const pr = PROVS[id];
          const aberto = prov === id;
          const logo = { logo: pr.logo, alt: pr.logoAlt, escura: pr.escura, larga: pr.larga };
          return (
            <li key={id}>
              <Dobra aberta={mostrarProvs && pr.modo === modo}>
                <Linha
                  id={`linha-${id}`}
                  inicio={<LogoTile {...logo} />}
                  nome={pr.nome}
                  frase={pr.linha}
                  extra={<SeloDificuldade provedor={pr} />}
                  aoEscolher={() => escolherProv(id)}
                />
              </Dobra>
              <Dobra aberta={aberto}>
                {(aberto || painelMontado === id) && (
                  <div className={s.painel} role="group" aria-label={pr.nome}>
                    <PainelCab inicio={<LogoTile {...logo} />} nome={pr.nome} frase={pr.linha} aoVoltar={voltarProv} />
                    {aberto && avisoW && erro && (
                      <AvisoErro
                        titulo={erro.titulo}
                        texto={erro.campo ? "Corrija o campo marcado e tente de novo." : "Tente conectar de novo."}
                      />
                    )}
                      <div className={s.camposGrade} data-colunas="2">
                        {pr.campos.map((c) => {
                          const largo = LARGOS[id].has(c.id);
                          const domId = idCampo(id, c.id);
                          const chaveRev = `${id}.${c.id}`;
                          const revelado = !!revelar[chaveRev];
                          const temErro = aberto && campoErro === c.id;
                          return (
                            <Campo
                              key={c.id}
                              id={domId}
                              className={largo ? s.campoLargo : undefined}
                              rotulo={c.label}
                              placeholder={c.ph}
                              type={c.tel ? "tel" : c.segredo && !revelado ? "password" : "text"}
                              {...(c.tel ? { inputMode: "tel" as const } : {})}
                              onChange={(ev) => mudarCampo(id, c.id, ev.target.value)}
                              onKeyDown={(ev) => {
                                if (ev.key !== "Enter") return;
                                ev.preventDefault();
                                if (completos(pr, preenchidos[id]) && fase === "form") conectar();
                              }}
                              autoComplete={c.tel ? "tel" : "off"}
                              spellCheck={false}
                              erro={temErro && erro ? erro.texto || erro.titulo : undefined}
                              dica={temErro ? undefined : c.ajuda}
                              sufixo={
                                c.segredo ? (
                                  <button
                                    type="button"
                                    className={s.olhar}
                                    aria-label={`${revelado ? "Ocultar" : "Mostrar"} ${c.label}`}
                                    onClick={() => setRevelar((atual) => ({ ...atual, [chaveRev]: !atual[chaveRev] }))}
                                  >
                                    {revelado ? "Ocultar" : "Mostrar"}
                                  </button>
                                ) : undefined
                              }
                            />
                          );
                        })}
                      </div>
                    {pr.gerados.length > 0 && (
                      <div className={s.bloco}>
                        <p className={s.meta}>{pr.geradosTitulo}</p>
                        {pr.gerados.map((g) => (
                          <ValorGerado key={g.id} gerado={g} />
                        ))}
                      </div>
                    )}
                    <div className={s.painelPe}>
                      <Botao
                        id={`btn-conectar-${id}`}
                        disabled={!completos(pr, preenchidos[id]) || fase !== "form"}
                        onClick={conectar}
                        iconeDepois={<Icone d={IC.seta} />}
                      >
                        Conectar
                      </Botao>
                    </div>
                  </div>
                )}
              </Dobra>
            </li>
          );
        })}
      </ul>
      <OutrosRodape
        aberta={!!p}
        logos={outros.map((o) => ({ logo: PROVS[o].logo, alt: PROVS[o].logoAlt, escura: PROVS[o].escura, larga: PROVS[o].larga }))}
        texto={
          outros.length
            ? (outros.length > 1 ? "Outros provedores: " : "Outro provedor: ") + juntar(outros.map((o) => PROVS[o].curto))
            : ""
        }
        aoVerTodos={voltarProv}
      />
    </CartaoLista>
  );
}

/** Selo de dificuldade do provedor (Fácil, Médio, Difícil), sob a frase da linha. */
function SeloDificuldade({ provedor }: { provedor: Provedor }) {
  const d = DIFICULDADE[provedor.dificuldade];
  return (
    <Selo compacto tom={d.tom} className={s.seloDificuldade}>
      <span className={s.sr}>Dificuldade: </span>
      {d.rotulo}
    </Selo>
  );
}

/** Um valor que o app gera ao conectar: antes do "Conectar", só o marcador (nunca um valor inventado). */
function ValorGerado({ gerado }: { gerado: Gerado }) {
  return (
    <div className={s.gerado}>
      <div className={s.geradoTexto}>
        <span className={s.geradoRotulo}>{gerado.label}</span>
        <span className={s.geradoPendente}>Gerado ao conectar</span>
      </div>
    </div>
  );
}

interface ValorParaCopiar {
  id: string;
  rotulo: string;
  valor: string;
}

/** O quadro "Falta 1 passo" do sucesso: os valores gravados pelo "Conectar", cada um com Copiar. */
function FaltaUmPasso({
  titulo,
  texto,
  valores,
  copiado,
  aoCopiar,
}: {
  titulo: string;
  texto: string;
  valores: readonly ValorParaCopiar[];
  copiado: string | null;
  aoCopiar: (id: string, valor: string, rotulo: string) => void;
}) {
  return (
    <div className={cx(s.bloco, s.sobe, s.d3)} role="group" aria-label={titulo}>
      <p className={s.geradoRotulo}>{titulo}</p>
      <p className={s.meta}>{texto}</p>
      {valores.map((v) => {
        const feito = copiado === v.id;
        return (
          <div key={v.id} className={s.gerado}>
            <div className={s.geradoTexto}>
              <span className={s.geradoRotulo}>{v.rotulo}</span>
              <code className={cx(s.geradoValor, s.mono)}>{v.valor}</code>
            </div>
            <Botao
              variante="contorno"
              className={cx(s.btnC, s.btnCopiar, feito && s.copiado)}
              onClick={() => aoCopiar(v.id, v.valor, v.rotulo)}
              aria-label={`${feito ? "Copiado: " : "Copiar "}${v.rotulo}`}
              icone={<Icone d={feito ? IC.feito : IC.copiar} tamanho="p" />}
            >
              {feito ? "Copiado" : "Copiar"}
            </Botao>
          </div>
        );
      })}
    </div>
  );
}
