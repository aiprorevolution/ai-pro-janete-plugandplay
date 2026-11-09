/**
 * Os erros do Firebase Auth em português, dizendo o que fazer. O texto original do Firebase
 * (em inglês) nunca aparece na tela.
 */

export type CampoConta = "email" | "senha";

export interface ErroConta {
  mensagem: string;
  /** O campo que precisa ser corrigido (recebe aria-invalid e o foco). */
  campo?: CampoConta;
  /** Saída sugerida: o e-mail já tem conta, então o caminho é entrar. */
  acao?: "entrar";
}

interface ErroBruto {
  /** 'api' quando o erro veio de /api/firebase: a mensagem já é do servidor, em português. */
  origem?: unknown;
  name?: unknown;
  message?: unknown;
  status?: unknown;
  code?: unknown;
  reasons?: unknown;
}

export const ERRO_EMAIL_JA_CADASTRADO: ErroConta = {
  mensagem: "Este e-mail já tem uma conta. Entre com ele.",
  campo: "email",
  acao: "entrar",
};

const SEM_INTERNET: ErroConta = {
  mensagem: "Sem conexão com a internet. Confira a sua rede e tente de novo.",
};

const MUITAS_TENTATIVAS: ErroConta = {
  mensagem: "Muitas tentativas em pouco tempo. Espere alguns minutos e tente de novo.",
};

function semInternet(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** Traduz o erro de `signUp` ou `signInWithPassword` (ou o que for lançado no caminho). */
export function traduzirErroConta(erro: unknown, onde: "criar" | "entrar"): ErroConta {
  const e = (typeof erro === "object" && erro !== null ? erro : {}) as ErroBruto;
  const codigo = typeof e.code === "string" ? e.code : "";
  const nome = typeof e.name === "string" ? e.name : "";
  const status = typeof e.status === "number" ? e.status : undefined;
  const mensagem = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if(codigo==='auth/popup-blocked')return {mensagem:'O navegador bloqueou a janela do Google. Permita pop-ups para este aplicativo e tente novamente.'};
  if(codigo==='auth/popup-closed-by-user'||codigo==='auth/cancelled-popup-request')return {mensagem:'O login com Google foi fechado. Clique em Entrar com Google para tentar novamente.'};
  if(codigo==='auth/unauthorized-domain')return {mensagem:'Este endereço ainda não foi autorizado no Firebase. Peça ao agente do AI Studio para concluir a configuração dos domínios de login desta cópia.'};
  if(codigo==='auth/operation-not-allowed')return {mensagem:'Este método de login ainda não está habilitado. Use Google ou peça ao agente para habilitar e-mail e senha no Firebase.'};
  if(codigo==='auth/email-already-in-use')return ERRO_EMAIL_JA_CADASTRADO;
  if(codigo==='auth/invalid-email')return {mensagem:'Confira o endereço de e-mail.',campo:'email'};
  if(codigo==='auth/weak-password')return {mensagem:'Use uma senha com pelo menos 8 caracteres.',campo:'senha'};
  if(codigo==='auth/invalid-credential'||codigo==='auth/wrong-password'||codigo==='auth/user-not-found')return {mensagem:'E-mail ou senha não conferem. Confira os dois e tente novamente.',campo:'senha'};
  if(codigo==='auth/too-many-requests')return MUITAS_TENTATIVAS;
  if(codigo==='auth/network-request-failed')return SEM_INTERNET;
  if(codigo==='auth/user-disabled')return {mensagem:'Esta conta está desativada. Fale com o administrador da Janete.'};
  if(codigo==='PERMISSION_DENIED'||codigo==='server_identity_required'||codigo==='firebase_not_configured')return {mensagem:'A instalação do Firebase ainda precisa ser concluída pelo agente do AI Studio. Confira as regras e a identidade do servidor.'};
  // Erro do servidor da Janete (sem acesso, índices, cota, prévia…): mostrar o motivo, e não a mensagem genérica.
  if(e.origem==='api'&&typeof e.message==='string'&&e.message.trim())return {mensagem:e.message.trim()};

  if (semInternet() || nome === "AuthRetryableFetchError" || status === 0 || erro instanceof TypeError) {
    return SEM_INTERNET;
  }
  if (
    codigo === "over_request_rate_limit" ||
    codigo === "over_email_send_rate_limit" ||
    status === 429 ||
    mensagem.includes("rate limit")
  ) {
    return MUITAS_TENTATIVAS;
  }
  if (codigo === "user_already_exists" || codigo === "email_exists" || mensagem.includes("already registered")) {
    return ERRO_EMAIL_JA_CADASTRADO;
  }
  if (codigo === "weak_password" || nome === "AuthWeakPasswordError") {
    const motivos = Array.isArray(e.reasons) ? e.reasons : [];
    if (motivos.includes("pwned")) {
      return {
        mensagem: "Esta senha aparece em vazamentos conhecidos. Escolha outra, que você não use em outro lugar.",
        campo: "senha",
      };
    }
    return {
      mensagem: "Esta senha é fraca. Use pelo menos 8 caracteres, misturando letras, números e símbolos.",
      campo: "senha",
    };
  }
  if (codigo === "email_address_invalid" || codigo === "email_address_not_authorized") {
    return { mensagem: "Este e-mail não foi aceito. Confira se está certo ou use outro.", campo: "email" };
  }
  if (codigo === "invalid_credentials" || mensagem.includes("invalid login credentials")) {
    return { mensagem: "E-mail ou senha não conferem. Confira os dois e tente de novo.", campo: "senha" };
  }
  if (codigo === "email_not_confirmed") {
    return {
      mensagem: "Confirme o seu e-mail antes de entrar: abra o link que enviamos para ele.",
      campo: "email",
    };
  }
  if (codigo === "signup_disabled" || codigo === "email_provider_disabled") {
    return { mensagem: "A criação de contas novas está fechada. Fale com quem administra a Janete." };
  }
  if (codigo === "user_banned") {
    return { mensagem: "Esta conta está bloqueada. Fale com quem administra a Janete." };
  }
  if (onde === "entrar") {
    return { mensagem: "Não deu para entrar agora. Tente de novo em instantes." };
  }
  return { mensagem: "Não deu para criar a conta agora. Tente de novo em instantes." };
}
