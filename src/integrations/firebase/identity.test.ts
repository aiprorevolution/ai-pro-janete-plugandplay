// @vitest-environment node
import {describe,it,expect,vi,afterEach} from 'vitest';
import {verifyFirebaseToken,identityFromRequest} from './identity.server';
vi.mock('./config.server',()=>({getInstallationConfig:async()=>({projectId:'demo-janete-identity',apiKey:'public-test-key',firestoreDatabaseId:'(default)'})}));
afterEach(()=>vi.unstubAllGlobals());
function token(overrides:Record<string,unknown>={}){const now=Math.floor(Date.now()/1000);const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');return `${encode({alg:'RS256'})}.${encode({sub:'person',aud:'demo-janete-identity',iss:'https://securetoken.google.com/demo-janete-identity',exp:now+3600,iat:now,firebase:{sign_in_provider:'google.com'},...overrides})}.signature-test`;}
function lookup(){vi.stubGlobal('fetch',vi.fn(async()=>Response.json({users:[{localId:'person',email:'person@example.test',displayName:'Pessoa',emailVerified:true}]})));}
describe('Firebase request identity',()=>{
 it('validates online before accepting identity and keeps provider for invitation policy',async()=>{lookup();const actor=await verifyFirebaseToken(token());expect(actor).toMatchObject({uid:'person',email:'person@example.test',verified:true,provider:'google.com'});expect(fetch).toHaveBeenCalledWith(expect.stringContaining('identitytoolkit.googleapis.com/v1/accounts:lookup?key=public-test-key'),expect.objectContaining({method:'POST'}));});
 it.each([{aud:'another-project'},{iss:'https://securetoken.google.com/another-project'},{sub:'someone-else'},{exp:1},{iat:9999999999}])('rejects installation/subject/time mismatch even when upstream answered successfully: %j',async claims=>{lookup();await expect(verifyFirebaseToken(token(claims))).rejects.toMatchObject({status:401});});
 it('does not accept token claims if Firebase verification refuses the token',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:{message:'INVALID_ID_TOKEN'}},{status:400})));await expect(verifyFirebaseToken(token())).rejects.toMatchObject({status:401});});
 it('rejects unauthenticated requests before network access',async()=>{const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);await expect(identityFromRequest(new Request('http://127.0.0.1/api/firebase'))).rejects.toMatchObject({status:401});expect(fetcher).not.toHaveBeenCalled();});
});
