import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { Aviso, Botao, Campo } from '@/components/aipro';
import { CartaoConta, classesConta as s } from '@/features/conta/CartaoConta';
import { firebase } from '@/integrations/firebase/client';
import type { ClienteFirebase } from '../dados/colunas';
import { CHAVES } from '../dados/chaves';
import { claimsDoToken, entrouPorLinkDoEmail } from './entrada';
export const MAX_NOME_CONVITE = 80;
export type RespostaAceitar = { ok: boolean; erro?: string; membroId?: string };
export interface PropsConviteConta { cliente?: ClienteFirebase | undefined; aceitar?: ((nome: string) => Promise<RespostaAceitar>) | undefined }
export function textoDoAceite(erro: string | undefined): string {
  if (erro === 'nao_encontrado') return 'Não há convite válido para esse e-mail. Peça ao administrador para conferir ou renovar o convite.';
  if (erro === 'link_necessario') return 'Entre com a conta Google do e-mail convidado.';
  if (erro === 'sem_acesso') return 'Sua conta está desativada. Fale com o administrador.';
  if (erro === 'nome_vazio') return 'Escreva o seu nome.';
  if (erro === 'email_em_uso') return 'Esse e-mail já está associado a outra conta da equipe.';
  return 'Não foi possível aceitar agora. Tente novamente.';
}
export function linkComErro(href: string): boolean { try { const u = new URL(href); return u.searchParams.has('error') || new URLSearchParams(u.hash.slice(1)).has('error'); } catch { return false; } }
const aceitarPadrao = async (nome: string): Promise<RespostaAceitar> => {
  const { aceitarConvite } = await import('./equipe.functions');
  return aceitarConvite({ data: { nome } });
};
export function ConviteConta({ cliente = firebase, aceitar = aceitarPadrao }: PropsConviteConta) {
  const navigate = useNavigate(); const cache = useQueryClient();
  const [nome, setNome] = useState(''); const [email, setEmail] = useState('');
  const [lendo, setLendo] = useState(true); const [verificado, setVerificado] = useState(false);
  const [ocupado, setOcupado] = useState(false); const [erro, setErro] = useState<string | null>(null);
  async function lerSessao() {
    const { data } = await cliente.auth.getSession();
    setEmail(data.session?.user.email ?? '');
    setVerificado(entrouPorLinkDoEmail(claimsDoToken(data.session?.access_token)));
    setLendo(false);
  }
  useEffect(() => { void lerSessao().catch(() => setLendo(false)); }, [cliente]);
  async function entrarGoogle() {
    setOcupado(true); setErro(null);
    try { const r = await cliente.auth.signInWithGoogle(); if (r.error) throw r.error; await lerSessao(); }
    catch { setErro('Não foi possível entrar com Google. Tente abrir a prévia em uma nova aba.'); }
    finally { setOcupado(false); }
  }
  async function entrar(event: FormEvent) {
    event.preventDefault(); if (ocupado) return;
    const limpo = nome.replace(/\s+/g, ' ').trim();
    if (!limpo) { setErro(textoDoAceite('nome_vazio')); return; }
    setOcupado(true); setErro(null);
    try {
      const result = await aceitar(limpo);
      if (!result.ok) { setErro(textoDoAceite(result.erro)); return; }
      cache.removeQueries({ queryKey: CHAVES.eu });
      await navigate({ to: '/app', replace: true });
    } catch { setErro(textoDoAceite('falha')); }
    finally { setOcupado(false); }
  }
  return <CartaoConta idTitulo="convite-titulo" titulo={lendo ? 'Abrindo o convite' : 'Entre na equipe'} subtitulo={email ? `Conta: ${email}. Use o mesmo e-mail que recebeu acesso do administrador.` : 'Entre com a conta Google do e-mail convidado.'}>
    {!lendo && (verificado ? <form className={s.form} onSubmit={entrar}>
      <Campo id="cv-nome" rotulo="Seu nome" maxLength={MAX_NOME_CONVITE} value={nome} onChange={e => setNome(e.target.value)} autoComplete="name" />
      {erro && <Aviso tom="erro" compacto>{erro}</Aviso>}
      <Botao type="submit" largo carregando={ocupado}>Entrar na equipe</Botao>
    </form> : <div className={s.form}>
      {erro && <Aviso tom="erro" compacto>{erro}</Aviso>}
      <Botao type="button" largo carregando={ocupado} onClick={() => void entrarGoogle()}>Entrar com Google</Botao>
    </div>)}
  </CartaoConta>;
}
