/**
 * A chamada à função de servidor falhou: foi a rede ou a sessão que terminou? O middleware
 * `requireFirebaseAuth` recusa a chamada sem sessão (por exemplo, depois de sair em outra aba), e
 * aí "confira a sua internet" deixaria a pessoa tentando de novo sem fim.
 */
export async function sessaoTerminou(): Promise<boolean> {
  try {
    const { firebase } = await import("@/integrations/firebase/client");
    const { data } = await firebase.auth.getSession();
    return !data.session;
  } catch {
    // sem como conferir: fica a mensagem de rede
    return false;
  }
}

/** Leva para o login (a sessão já não existe, então a página recarrega do zero). */
export function irParaEntrar(): void {
  if (typeof window !== "undefined") window.location.assign("/entrar");
}
