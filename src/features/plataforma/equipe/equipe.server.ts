/** Convites por conta Google verificada. O link é compartilhado pelo administrador. */
import { firestoreStore } from '@/integrations/firebase/store.server';
import { currentActor } from '@/integrations/firebase/identity.server';
import { criarConvite, consultarConvite, aceitarConviteGoogle } from './equipe-store.server';
import type { ContextoUsuario } from '../dados/servidor.server';
import type { ClaimsSessao } from './entrada';
export { normalizarEmail, limparNome, MAX_EMAIL, MAX_NOME } from './equipe-store.server';
export { entrouPorLinkDoEmail, type ClaimsSessao } from './entrada';
export type { ContextoUsuario };
export type ContextoComOrigem = ContextoUsuario & { origem: string };
export type ContextoAceitar = ContextoUsuario & { claims?: ClaimsSessao | null | undefined; token?: string | null | undefined };
export type EntradaConvidar = { email: string; papel: 'admin' | 'atendente' };
export type EntradaConvite = { conviteId: string };
export type EntradaAceitar = { nome: string };
export type Falha = { ok: false; erro: 'falha'|'sem_acesso'|'nao_encontrado'|'email_invalido'|'proprio_membro'|'email_em_uso'|'nome_vazio'|'link_necessario'; mensagem?: string };
export type AvisoEmail = 'email_nao_enviado';
export type ResultadoConvidar = { ok: true; conviteId: string; aviso?: AvisoEmail } | Falha;
export type ResultadoLinkDoConvite = { ok: true; link: string } | Falha;
export type ResultadoReenviar = { ok: true; aviso?: AvisoEmail } | Falha;
export type ResultadoCancelar = { ok: true } | Falha;
export type ResultadoAceitar = { ok: true; membroId: string } | Falha;
export const CAMINHO_CONVITE = '/convite';
export function enderecoDoConvite(origem: string): string | null {
  try { const url = new URL(origem); return ['https:', 'http:'].includes(url.protocol) ? `${url.origin}${CAMINHO_CONVITE}` : null; } catch { return null; }
}
function contexto(ctx: ContextoUsuario) {
  const actor = currentActor();
  if (actor.system || actor.uid !== ctx.userId) throw new Error('sem_acesso');
  return { store: firestoreStore, actor };
}
function falha(error: unknown): Falha {
  const code = error instanceof Error ? error.message : '';
  if (code === 'email_membro' || code === 'email_convite') return { ok: false, erro: 'email_em_uso', mensagem: code === 'email_membro' ? 'membro' : 'convite' };
  if (['sem_acesso','nao_encontrado','email_invalido','proprio_membro','nome_vazio','link_necessario'].includes(code)) return { ok: false, erro: code as Falha['erro'] };
  return { ok: false, erro: 'falha', mensagem: 'operacao_de_equipe_falhou' };
}
export async function convidarMembroLogica(ctx: ContextoComOrigem, input: EntradaConvidar): Promise<ResultadoConvidar> {
  try { return await criarConvite(contexto(ctx), input.email, input.papel); } catch (error) { return falha(error); }
}
export async function linkDoConviteLogica(ctx: ContextoComOrigem, input: EntradaConvite): Promise<ResultadoLinkDoConvite> {
  try { await consultarConvite(contexto(ctx), input.conviteId, 'ler'); const link = enderecoDoConvite(ctx.origem); if (!link) throw new Error('origem_invalida'); return { ok: true, link }; } catch (error) { return falha(error); }
}
export async function reenviarConviteLogica(ctx: ContextoComOrigem, input: EntradaConvite): Promise<ResultadoReenviar> {
  try { await consultarConvite(contexto(ctx), input.conviteId, 'renovar'); return { ok: true }; } catch (error) { return falha(error); }
}
export async function cancelarConviteLogica(ctx: ContextoUsuario, input: EntradaConvite): Promise<ResultadoCancelar> {
  try { await consultarConvite(contexto(ctx), input.conviteId, 'cancelar'); return { ok: true }; } catch (error) { return falha(error); }
}
export async function aceitarConviteLogica(ctx: ContextoAceitar, input: EntradaAceitar): Promise<ResultadoAceitar> {
  try { return await aceitarConviteGoogle(contexto(ctx), input.nome); } catch (error) { return falha(error); }
}
