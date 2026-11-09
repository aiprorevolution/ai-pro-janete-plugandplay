
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {Outlet,RouterProvider,createMemoryHistory,createRootRoute,createRoute,createRouter} from '@tanstack/react-router';
import {afterEach,describe,expect,it,vi} from 'vitest';
vi.mock('@/integrations/firebase/client',()=>({firebase:{}}));
import {ConviteConta,linkComErro,textoDoAceite} from '@/features/plataforma/equipe/ConviteConta';
import type {ClienteFirebase} from '@/features/plataforma/dados/colunas';
import {claimsDoToken,entrouPorLinkDoEmail} from '@/features/plataforma/equipe/entrada';
afterEach(cleanup);
const token=(verified:boolean)=>'header.'+btoa(JSON.stringify({email:'pessoa@example.test',email_verified:verified}))+'.signature';
async function mount(verified:boolean|null,accept=vi.fn(async(_name:string)=>({ok:true})),googleError=false){
 let session=verified===null?null:{user:{id:'novo',email:'pessoa@example.test'},access_token:token(verified)};
 const google=vi.fn(async()=>{if(googleError)return {error:Error('internal-secret')};session={user:{id:'novo',email:'pessoa@example.test'},access_token:token(true)};return {error:null};});
 const client={auth:{getSession:async()=>({data:{session}}),signInWithGoogle:google}} as unknown as ClienteFirebase;
 const root=createRootRoute({component:()=> <Outlet/>});
 const invite=createRoute({getParentRoute:()=>root,path:'/convite',component:()=> <ConviteConta cliente={client} aceitar={accept}/>});
 const app=createRoute({getParentRoute:()=>root,path:'/app',component:()=> <h1>Plataforma</h1>});
 const router=createRouter({routeTree:root.addChildren([invite,app]),history:createMemoryHistory({initialEntries:['/convite']})});
 render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router}/></QueryClientProvider>);
 await screen.findByRole('heading',{name:'Entre na equipe'});return {google,accept};
}
describe('Aceite por Google',()=>{
 it('desconectado entra com Google e só depois escolhe nome',async()=>{const m=await mount(null);expect(screen.queryByLabelText('Seu nome')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Entrar com Google'}));await screen.findByLabelText('Seu nome');expect(m.google).toHaveBeenCalledOnce();expect(screen.queryByLabelText('Senha')).toBeNull();});
 it('conta sem e-mail verificado não recebe formulário de aceite',async()=>{await mount(false);expect(screen.queryByLabelText('Seu nome')).toBeNull();expect(screen.getByRole('button',{name:'Entrar com Google'})).toBeTruthy();});
 it('envia nome normalizado e entra na plataforma',async()=>{const m=await mount(true);fireEvent.change(screen.getByLabelText('Seu nome'),{target:{value:'  Pessoa   Teste  '}});fireEvent.click(screen.getByRole('button',{name:'Entrar na equipe'}));await screen.findByRole('heading',{name:'Plataforma'});expect(m.accept).toHaveBeenCalledWith('Pessoa Teste');});
 it('nome vazio não chama o servidor',async()=>{const m=await mount(true);fireEvent.click(screen.getByRole('button',{name:'Entrar na equipe'}));await screen.findByText('Escreva o seu nome.');expect(m.accept).not.toHaveBeenCalled();});
 it('convite inexistente mantém usuário na tela com orientação',async()=>{await mount(true,vi.fn(async()=>({ok:false,erro:'nao_encontrado'})));fireEvent.change(screen.getByLabelText('Seu nome'),{target:{value:'Pessoa'}});fireEvent.click(screen.getByRole('button',{name:'Entrar na equipe'}));await screen.findByText(textoDoAceite('nao_encontrado'));expect(screen.queryByRole('heading',{name:'Plataforma'})).toBeNull();});
 it('falha do Google não mostra mensagem interna ou segredo',async()=>{await mount(null,undefined,true);fireEvent.click(screen.getByRole('button',{name:'Entrar com Google'}));await screen.findByText(/Não foi possível entrar com Google/);expect(document.body.textContent).not.toContain('internal-secret');});
 it('bloqueia duplo envio enquanto aguarda resposta',async()=>{let resolve:(v:{ok:boolean})=>void=()=>{};const accept=vi.fn(()=>new Promise<{ok:boolean}>(r=>resolve=r));await mount(true,accept);fireEvent.change(screen.getByLabelText('Seu nome'),{target:{value:'Pessoa'}});const button=screen.getByRole('button',{name:'Entrar na equipe'});fireEvent.click(button);fireEvent.click(button);await waitFor(()=>expect(accept).toHaveBeenCalledOnce());resolve({ok:false});await screen.findByText(textoDoAceite('falha'));});
 it('claims da tela só habilitam UI; token inválido não habilita aceite',()=>{expect(claimsDoToken('invalid')).toBeNull();expect(entrouPorLinkDoEmail(claimsDoToken(token(false)))).toBe(false);expect(entrouPorLinkDoEmail(claimsDoToken(token(true)))).toBe(true);expect(linkComErro('https://example.test/convite?error=denied')).toBe(true);});
});
