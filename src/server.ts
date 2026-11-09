import { renderErrorPage } from './lib/error-page';
type Entry = { fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response };
let entry: Promise<Entry> | undefined;
export default {
  async fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> {
    try {
      const pathname = new URL(request.url).pathname;
      if (pathname === '/healthz') return Response.json({ status: 'ok', application: 'AI PRO Janete' });
      if (pathname.startsWith('/api/public/midia/')) {
        const { servirMidiaPublica } = await import('./integrations/firebase/storage.server');
        return await servirMidiaPublica(request);
      }
      if (pathname.startsWith('/api/firebase')) {
        const { handleFirebaseRequest } = await import('./integrations/firebase/api.server');
        const response = await handleFirebaseRequest(request);
        if (response) return response;
      }
      entry ??= import('@tanstack/react-start/server-entry').then(m => (m.default ?? m) as Entry);
      return await (await entry).fetch(request, env, ctx);
    } catch {
      console.error('AI PRO Janete: falha na requisição.');
      const api = new URL(request.url).pathname.startsWith('/api/');
      return api ? Response.json({ error: 'Não foi possível concluir a operação.' }, { status: 500 })
        : new Response(renderErrorPage(), { status: 500, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
  },
};
