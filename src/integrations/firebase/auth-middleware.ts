import {createMiddleware} from '@tanstack/react-start';
import {getRequest} from '@tanstack/react-start/server';
import {identityFromRequest,requestIdentity} from './identity.server';
import {firebaseAdmin} from './client.server';
export const requireFirebaseAuth=createMiddleware({type:'function'}).server(async({next})=>{
 const identity=await identityFromRequest(getRequest());
 return requestIdentity.run(identity,()=>next({context:{firebase:firebaseAdmin,userId:identity.actor.uid,claims:{sub:identity.actor.uid,email:identity.actor.email,email_verified:identity.actor.verified,firebase:{sign_in_provider:identity.actor.provider??''}}}}));
});
