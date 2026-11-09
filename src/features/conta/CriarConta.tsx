import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";

import { movimentoReduzido } from "@/components/janete/VooJanete";
import { Aviso, BotaoLink, Botao, Campo } from "@/components/aipro";
import { firebase } from "@/integrations/firebase/client";

import { CampoSenhaConta, CartaoConta, classesConta as s } from "./CartaoConta";
import { comecarProgresso } from "./dono";
import { ERRO_EMAIL_JA_CADASTRADO, traduzirErroConta, type ErroConta } from "./erros";
import { ESPERA_NO_CENTRO_MS, usePalcoConta } from "./PalcoConta";
import { detalheContaCriada, emailValido, SENHA_MINIMA } from "./validacao";

/** O botão gira pelo menos isto antes de a passagem começar (Entrar e Criar conta). */
export const TEMPO_GIRO_MS = 380;

const ERRO_EMAIL_FORMATO = "Confira o e-mail. Falta algo como @empresa.com.br.";
const ANUNCIO_CRIADA = "Conta criada. Preparando o seu espaço…";

function focar(id: string) {
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el && !(el as HTMLInputElement).disabled) el.focus({ preventScroll: true });
  }, 60);
}

/**
 * /criar-conta: o cartão do palco do login (proposta A), com o cadastro de verdade no Firebase.
 * Com sessão criada, o botão gira, o palco faz a passagem (o cartão fecha no ponto e a bola se
 * contrai até o centro), o símbolo em trânsito pousa no lugar dela com a legenda "Preparando o
 * seu espaço" e, 660 ms depois, a rota troca para /onboarding, onde a etapa conexão assume.
 */
export function CriarConta() {
  const navigate = useNavigate();
  const palco = usePalcoConta();

  const [nome, setNome] = useState("");
  // O e-mail digitado no Entrar vem junto (a senha nunca).
  const [email, setEmail] = useState(() => palco.email);
  const [senha, setSenha] = useState("");
  const [emailTocado, setEmailTocado] = useState(false);
  const [criando, setCriando] = useState(false);
  const [criada, setCriada] = useState(false);
  const [erro, setErro] = useState<ErroConta | null>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);

  const montado = useRef(true);
  const titulo = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  // Ao trocar para "confira seu e-mail", o foco vai para o título novo.
  useEffect(() => {
    if (confirmar) titulo.current?.focus({ preventScroll: true });
  }, [confirmar]);

  const emailOk = emailValido(email);
  const erroFormatoEmail = email.trim().length > 0 && !emailOk && (emailTocado || senha.length > 0);
  const bloqueada = !(nome.trim() && emailOk && senha.length >= SENHA_MINIMA) || criando;

  const irParaOnboarding = () => navigate({ to: "/onboarding", replace: true });

  /** Sem a passagem animada (movimento reduzido, sem WAAPI, palco ausente), o foco vai para a
   *  primeira opção da conexão, como o `irPara(1); focar('linha-modo-oficial')` do F. */
  const irParaOnboardingSemVoo = () => {
    void irParaOnboarding().then(() => focar("linha-modo-oficial"));
  };

  /**
   * A passagem do palco: no fim, o símbolo em trânsito já pousou no centro com a legenda. Com ela
   * feita, a sessão já existe e ir para /onboarding não depende desta tela continuar montada: o
   * Voltar do navegador no meio dela troca o filho do palco, mas a passagem segue até o fim, e o
   * símbolo ficaria parado com a legenda para sempre. Por isso o timer não é dos que o desmontar limparia.
   */
  const passarEIr = async () => {
    const ok = await palco.passagem({
      voo: true,
      legenda: { titulo: "Preparando o seu espaço", detalhe: detalheContaCriada(nome) },
    });
    if (ok) {
      setTimeout(() => void irParaOnboarding(), ESPERA_NO_CENTRO_MS);
      return;
    }
    if (montado.current) irParaOnboardingSemVoo();
  };

  const criarConta = async (ev?: FormEvent) => {
    ev?.preventDefault();
    if (bloqueada) return;
    // Enviar durante a entrada não espera a coreografia: a tela assenta na hora.
    palco.assentar();
    const inicio = Date.now();
    setCriando(true);
    setErro(null);

    let resposta: Awaited<ReturnType<typeof firebase.auth.signUp>> | null = null;
    let falha: unknown = null;
    try {
      resposta = await firebase.auth.signUp({
        email: email.trim(),
        password: senha,
        options: { data: { nome: nome.trim() } },
      });
      falha = resposta.error;
    } catch (e) {
      falha = e;
    }
    const usuario = resposta?.data.user ?? null;
    let problema: ErroConta | null = falha ? traduzirErroConta(falha, "criar") : null;
    // Com a proteção contra descoberta de e-mails, o Firebase devolve um usuário sem identidades
    // (e sem erro) quando o e-mail já tem conta.
    if (!problema && usuario && Array.isArray(usuario.identities) && usuario.identities.length === 0) {
      problema = ERRO_EMAIL_JA_CADASTRADO;
    }
    const sessao = problema ? null : (resposta?.data.session ?? null);
    if (!montado.current) {
      // A tela saiu enquanto o Firebase respondia (o Voltar do navegador). Com sessão, a conta nova
      // vai direto ao onboarding, sem passagem; sem ela, não há o que fazer.
      if (sessao) {
        comecarProgresso(usuario?.id ?? sessao.user?.id);
        irParaOnboardingSemVoo();
      }
      return;
    }
    if (problema) {
      setCriando(false);
      setErro(problema);
      if (problema.campo) focar(problema.campo === "email" ? "c-email" : "c-senha");
      return;
    }
    if (!sessao) {
      // Confirmação de e-mail ligada no projeto: a conta existe, mas só entra depois do link. O
      // "Ir para Entrar" leva o e-mail junto, pelo palco.
      palco.definirEmail(email.trim());
      setCriando(false);
      setConfirmar(email.trim());
      return;
    }

    // Conta nova, onboarding do zero (nada da aba anterior vale para ela), e o progresso passa a ser dela.
    comecarProgresso(usuario?.id ?? sessao.user?.id);
    // O anúncio vai para a tela já: da passagem em diante o cartão fica inert, e a região de anúncio
    // dele sai da árvore de acessibilidade.
    flushSync(() => setCriada(true));
    if (movimentoReduzido()) {
      irParaOnboardingSemVoo();
      return;
    }
    // O botão gira pelo menos 380 ms (de novo fora dos timers do desmontar: se a tela sair nesse meio,
    // vai direto ao onboarding).
    setTimeout(
      () => (montado.current ? void passarEIr() : irParaOnboardingSemVoo()),
      Math.max(0, TEMPO_GIRO_MS - (Date.now() - inicio)),
    );
  };

  if (confirmar) {
    return (
      <CartaoConta
        idTitulo="t0-titulo"
        refTitulo={titulo}
        titulo="Confira seu e-mail"
        subtitulo={
          <>
            Enviamos um link de confirmação para <b>{confirmar}</b>. Abra o link e depois entre na sua conta.
          </>
        }
        anuncio="Conta criada. Confira seu e-mail para confirmar."
      >
        <BotaoLink to="/entrar" tamanho="grande" largo data-bloco="2">
          Ir para Entrar
        </BotaoLink>
      </CartaoConta>
    );
  }

  const erroEmail = erroFormatoEmail ? ERRO_EMAIL_FORMATO : erro?.campo === "email" && !erro.acao ? erro.mensagem : undefined;
  const erroSenha = erro?.campo === "senha" ? erro.mensagem : undefined;
  const erroGeral = erro && (!erro.campo || erro.acao) ? erro : null;

  const anuncio = criada ? ANUNCIO_CRIADA : criando ? "Criando sua conta…" : "";

  return (
    <CartaoConta
      idTitulo="t0-titulo"
      refTitulo={titulo}
      titulo="Crie sua conta"
      subtitulo="Depois você conecta o WhatsApp e acorda a Janete, a vendedora que vai atender os seus leads."
      anuncio={anuncio}
    >
      <form className={s.form} onSubmit={criarConta} noValidate>
        <Campo
          id="c-nome"
          rotulo="Seu nome"
          type="text"
          autoComplete="name"
          value={nome}
          onChange={(ev) => setNome(ev.target.value)}
          placeholder="Como você quer ser chamado"
        />
        <Campo
          id="c-email"
          rotulo="E-mail de trabalho"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(ev) => {
            setEmail(ev.target.value);
            palco.definirEmail(ev.target.value);
            if (erro?.campo === "email") setErro(null);
          }}
          onBlur={() => setEmailTocado(true)}
          placeholder="voce@empresa.com.br"
          erro={erroEmail}
        />
        <CampoSenhaConta
          id="c-senha"
          valor={senha}
          aoMudar={(v) => {
            setSenha(v);
            if (erro?.campo === "senha") setErro(null);
          }}
          autoComplete="new-password"
          comMedida
          placeholder="Crie uma senha"
          erro={erroSenha}
        />
        {erroGeral ? (
          <Aviso
            tom="erro"
            compacto
            acao={
              erroGeral.acao === "entrar" ? (
                <BotaoLink to="/entrar" variante="contorno" tamanho="compacto">
                  Entrar
                </BotaoLink>
              ) : undefined
            }
          >
            {erroGeral.mensagem}
          </Aviso>
        ) : null}
        <Botao type="submit" tamanho="grande" largo disabled={bloqueada && !criando} carregando={criando} data-bloco="2">
          {criando ? "Criando sua conta" : "Criar conta"}
        </Botao>
      </form>
      {/* Enquanto cria a conta, a troca de tela fica travada (como o protótipo, que só troca em
          "aberto"): sair daqui no meio deixaria a conta criada numa tela do login. */}
      <p className={s.rodape} data-bloco="3" inert={criando}>
        Já tem conta?{" "}
        <Link to="/entrar" className={s.link}>
          Entrar
        </Link>
      </p>
    </CartaoConta>
  );
}
