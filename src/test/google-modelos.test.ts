import { describe, expect, it, vi } from 'vitest';
import { listarModelosLogica } from '@/features/servidor/listar-modelos-logica';
import { validarChaveIALogica } from '@/features/servidor/chave-ia';

const chave = 'fixture-google-nao-e-uma-chave';
describe('Gemini com a chave do aluno', () => {
  it('lista páginas reais, remove modelos incompatíveis e não expõe a chave', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ models: [
      { name: 'models/gemini-texto-teste', displayName: 'Texto', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-image-teste', supportedGenerationMethods: ['generateContent'] },
    ], nextPageToken: 'pagina-2' }))).mockResolvedValueOnce(new Response(JSON.stringify({models: [
      { name: 'models/gemini-outro-teste', supportedGenerationMethods: ['generateContent'] },
    ]})));
    const r = await listarModelosLogica({ provedor: 'gemini', chave }, { fetch: request });
    expect(r.ok && r.modelos.map(m => m.id)).toEqual(['gemini-outro-teste', 'gemini-texto-teste']);
    expect(request.mock.calls[1]?.[0]).toContain('pageToken=pagina-2');
    expect(request.mock.calls[0]?.[0]).not.toContain(chave);
    expect(JSON.stringify(r)).not.toContain(chave);
  });
  it('valida via GET de metadados sem gerar conteúdo', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ supportedGenerationMethods: ['generateContent'] })));
    const r = await validarChaveIALogica({ provedor: 'gemini', chave, modelo: 'models/gemini-texto-teste' }, { fetch: request });
    expect(r).toEqual({ ok: true, ultimos4: 'have' });
    expect(request.mock.calls[0]?.[0]).toMatch(/\/models\/gemini-texto-teste$/);
    expect(request.mock.calls[0]?.[1]?.method).toBe('GET');
  });
  it('traduz recusa sem refletir o segredo do provedor', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: chave } }), { status: 403 }));
    const r = await validarChaveIALogica({ provedor: 'gemini', chave, modelo: 'gemini-teste' }, { fetch: request });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(chave);
    expect(JSON.stringify(r)).toContain('permiss');
  });
});
