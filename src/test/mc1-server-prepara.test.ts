
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({fetch:vi.fn(),firebase:vi.fn()}));
vi.mock('@tanstack/react-start/server-entry',()=>({default:{fetch:mocks.fetch}}));
vi.mock('@/integrations/firebase/api.server',()=>({handleFirebaseRequest:mocks.firebase}));
import server from '@/server';
beforeEach(()=>{vi.clearAllMocks();mocks.fetch.mockResolvedValue(new Response('pagina'));mocks.firebase.mockResolvedValue(null);});
const request=(path:string)=>new Request('https://janete.example'+path);
describe('Servidor Google',()=>{
 it('healthz não depende de banco, login nem preparação SQL',async()=>{const response=await server.fetch(request('/healthz'),{},{});expect(await response.json()).toEqual({status:'ok',application:'AI PRO Janete'});expect(mocks.fetch).not.toHaveBeenCalled();expect(mocks.firebase).not.toHaveBeenCalled();});
 it('encaminha a API Firebase antes das páginas',async()=>{mocks.firebase.mockResolvedValue(Response.json({configured:false}));const response=await server.fetch(request('/api/firebase/config'),{},{});expect(await response.json()).toEqual({configured:false});expect(mocks.fetch).not.toHaveBeenCalled();});
 it('encaminha as páginas ao TanStack sem migrações automáticas',async()=>{expect(await(await server.fetch(request('/app'),{},{})).text()).toBe('pagina');expect(mocks.fetch).toHaveBeenCalledTimes(1);});
 it.each(['/api/firebase','/api/public/cron/mensageria'])('oculta detalhes internos na falha de %s',async path=>{mocks.fetch.mockRejectedValue(Error('token-nao-pode-vazar'));mocks.firebase.mockRejectedValue(Error('token-nao-pode-vazar'));const response=await server.fetch(request(path),{},{});expect(response.status).toBe(500);expect(response.headers.get('content-type')).toContain('application/json');expect(await response.text()).not.toContain('token-nao-pode-vazar');});
 it('a falha de página usa a marca e não expõe stack',async()=>{mocks.fetch.mockRejectedValue(Error('secret-interno'));const response=await server.fetch(request('/app'),{},{});expect(response.status).toBe(500);const html=await response.text();expect(html).toContain('AI PRO Janete');expect(html).not.toContain('secret-interno');});
});
