import type { RpcContext } from '@/integrations/firebase/store-types';
import { audit, eq, fail, iso, requireMember, transact } from '@/integrations/firebase/rpc-common';
const VALID_EMAIL = /^[^\s@/]+@[^\s@/]+\.[^\s@/]{2,}$/;
export const MAX_EMAIL = 254;
export const MAX_NOME = 80;
export function normalizarEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return email.length <= MAX_EMAIL && VALID_EMAIL.test(email) ? email : null;
}
export function limparNome(value: string): string | null { return value.replace(/\s+/g, ' ').trim().slice(0, MAX_NOME) || null; }
const validade = () => ({ expires_at: new Date(Date.now() + 7 * 86400000).toISOString(), expires_at_ms: Date.now() + 7 * 86400000 });
export async function criarConvite(ctx: RpcContext, emailValue: string, papel: string) {
  const email = normalizarEmail(emailValue);
  if (!email) fail('email_invalido');
  if (!['admin', 'atendente'].includes(papel)) fail('sem_acesso');
  return transact(ctx.store, async tx => {
    const member = await requireMember(tx, ctx.actor, true);
    if (String(member['email']).toLowerCase() === email) fail('proprio_membro');
    if ((await tx.list('membros', { filters: [eq('email', email)], limit: 1 })).length) fail('email_membro');
    if (await tx.get('convites', email!)) fail('email_convite');
    await tx.set('convites', email!, { id: email, email, papel, user_id: null, convidado_por: member['id'], criado_em: iso(), ...validade() });
    await audit(tx, member['id'], 'membro_convidado', email, { papel });
    return { ok: true as const, conviteId: email! };
  });
}
export async function consultarConvite(ctx: RpcContext, id: string, action: 'ler' | 'renovar' | 'cancelar') {
  if (!normalizarEmail(id)) fail('nao_encontrado');
  return transact(ctx.store, async tx => {
    const member = await requireMember(tx, ctx.actor, true);
    const invite = await tx.get('convites', id);
    if (!invite) fail('nao_encontrado');
    if (action === 'cancelar') await tx.delete('convites', id);
    if (action === 'renovar') await tx.set('convites', id, { ...invite, reenviado_em: iso(), ...validade() });
    if (action !== 'ler') await audit(tx, member['id'], action === 'cancelar' ? 'convite_cancelado' : 'convite_renovado', id);
    return invite;
  });
}
export async function aceitarConviteGoogle(ctx: RpcContext, nameValue: string) {
  const actor = ctx.actor;
  const nome = limparNome(nameValue);
  if (!nome) fail('nome_vazio');
  if (!actor?.verified || !actor.email || actor.system) fail('link_necessario');
  const email = normalizarEmail(actor!.email!);
  if (!email) fail('sem_acesso');
  return transact(ctx.store, async tx => {
    const existing = await tx.get('membros', actor!.uid);
    if (existing) {
      if (existing['ativo'] !== true) fail('sem_acesso');
      return { ok: true as const, membroId: actor!.uid };
    }
    const invite = await tx.get('convites', email!);
    if (!invite || invite['email'] !== email || !Number.isFinite(Number(invite['expires_at_ms'])) || Number(invite['expires_at_ms']) <= Date.now()) fail('nao_encontrado');
    if (!['admin', 'atendente'].includes(invite!['papel'])) fail('sem_acesso');
    await tx.set('membros', actor!.uid, { id: actor!.uid, user_id: actor!.uid, email, nome, papel: invite!['papel'], ativo: true, convidado_por: invite!['convidado_por'], criado_em: iso(), atualizado_em: iso(), vistos: {} });
    await tx.delete('convites', email!);
    await audit(tx, actor!.uid, 'membro_entrou', actor!.uid, { papel: invite!['papel'] });
    return { ok: true as const, membroId: actor!.uid };
  });
}
