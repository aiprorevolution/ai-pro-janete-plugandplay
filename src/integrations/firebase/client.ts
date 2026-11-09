import {initializeApp,getApps,type FirebaseApp} from 'firebase/app';
import {getAuth,GoogleAuthProvider,signInWithPopup,signInWithEmailAndPassword,createUserWithEmailAndPassword,signOut,updateProfile,updatePassword,sendPasswordResetEmail,sendEmailVerification,onIdTokenChanged,type User as FirebaseUser} from 'firebase/auth';
import {getFirestore,doc,onSnapshot} from 'firebase/firestore';
import {normalizeConfig,type InstallationConfig} from './config';
import {createQuery,type QueryRequest} from './query';
import type {AuthFacade,AuthEvent,FirebaseClient,Session,User} from './client-contract';
export type {FirebaseClient,User,Session} from './client-contract';
let configPromise:Promise<InstallationConfig|null>|undefined;
let appPromise:Promise<FirebaseApp|null>|undefined;
export function getClientConfiguration():Promise<InstallationConfig|null>{
 if(typeof window==='undefined')return Promise.resolve(null);
 return configPromise??=fetch('/api/firebase/config',{cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error('A configuração da instalação não carregou.');return normalizeConfig(await r.json());}).catch(error=>{configPromise=undefined;throw error;});
}
async function getApp(){return appPromise??=(async()=>{const config=await getClientConfiguration();if(!config)return null;return getApps().find(app=>app.name==='ai-pro-janete')??initializeApp(config,'ai-pro-janete');})().catch(error=>{appPromise=undefined;throw error;});}
async function authRequired(){const app=await getApp();if(!app)throw new Error('Ative a integração Firebase no Google AI Studio para começar.');const auth=getAuth(app);await auth.authStateReady();return auth;}
function mappedUser(user:FirebaseUser):User{return {id:user.uid,email:user.email??'',...(user.emailVerified?{email_confirmed_at:user.metadata.creationTime??''}:{}),user_metadata:{nome:user.displayName??'',name:user.displayName??'',avatar_url:user.photoURL??''},identities:user.providerData.map(x=>({provider:x.providerId})),...(user.metadata.creationTime?{created_at:user.metadata.creationTime}:{})};}
async function mappedSession(user:FirebaseUser|null):Promise<Session|null>{return user?{access_token:await user.getIdToken(),user:mappedUser(user)}:null;}
async function requestApi(body:unknown){
 const auth=await authRequired();if(!auth.currentUser)throw new Error('Entre na sua conta para continuar.');
 const response=await fetch('/api/firebase',{method:'POST',headers:{'content-type':'application/json',Authorization:`Bearer ${await auth.currentUser.getIdToken()}`},body:JSON.stringify(body)});
 const data=await response.json().catch(()=>({error:{message:'O servidor não respondeu como esperado.'}}));
 if(!response.ok)throw Object.assign(new Error(data.error?.message??'Não foi possível concluir agora.'),{code:data.error?.code,status:response.status});
 return data;
}
async function bootstrap(){await requestApi({kind:'bootstrap'});}
async function signIn(action:()=>Promise<{user:FirebaseUser}>){try{const {user}=await action();if(!user.emailVerified){await signOut(await authRequired());throw Object.assign(new Error('Confirme seu e-mail antes de entrar.'),{code:'email_not_confirmed'});}await bootstrap();return {data:{user:mappedUser(user),session:await mappedSession(user)},error:null};}catch(error){return {data:{user:null,session:null},error};}}
const auth:AuthFacade={
 async getSession(){try{const app=await getApp();if(!app)return {data:{session:null},error:null};const a=getAuth(app);await a.authStateReady();return {data:{session:await mappedSession(a.currentUser)},error:null};}catch(error){return {data:{session:null},error};}},
 async getUser(){const result=await this.getSession();return {data:{user:result.data.session?.user??null},error:result.error};},
 signInWithPassword(input){return signIn(async()=>signInWithEmailAndPassword(await authRequired(),input.email,input.password));},
 signInWithGoogle(){return signIn(async()=>{const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});return signInWithPopup(await authRequired(),provider);});},
 async signUp(input){try{const a=await authRequired();const result=await createUserWithEmailAndPassword(a,input.email,input.password);await updateProfile(result.user,{displayName:String(input.options?.data?.['nome']??input.options?.data?.['name']??'')});await sendEmailVerification(result.user);const user=mappedUser(result.user);await signOut(a);return {data:{user,session:null},error:null};}catch(error){return {data:{user:null,session:null},error};}},
 async signOut(){try{const app=await getApp();if(app)await signOut(getAuth(app));return {error:null};}catch(error){return {error};}},
 async resetPasswordForEmail(email){try{await sendPasswordResetEmail(await authRequired(),email);return {error:null};}catch(error){return {error};}},
 async updateUser(input){try{const a=await authRequired();if(!a.currentUser)throw new Error('Entre novamente.');if(input.password)await updatePassword(a.currentUser,input.password);if(input.data)await updateProfile(a.currentUser,{displayName:String(input.data['nome']??input.data['name']??'')});return {data:{user:mappedUser(a.currentUser)},error:null};}catch(error){return {data:{user:null},error};}},
 onAuthStateChange(callback){let closed=false;let unsubscribe=()=>{};void getApp().then(app=>{if(!app||closed)return;let previous:string|null|undefined=undefined;unsubscribe=onIdTokenChanged(getAuth(app),async user=>{const event:AuthEvent=previous===undefined?'INITIAL_SESSION':user?.uid===previous?'TOKEN_REFRESHED':user?'SIGNED_IN':'SIGNED_OUT';previous=user?.uid??null;const session=await mappedSession(user);if(!closed)callback(event,session);});}).catch(()=>{});return {data:{subscription:{unsubscribe(){closed=true;unsubscribe();}}}};},
};
class ChangeChannel{
 private watchers:{table:string;callback:(payload:any)=>void}[]=[];private unsubs:(()=>void)[]=[];private closed=false;
 on(_type:string,filter:{table:string},callback:(payload:any)=>void){this.watchers.push({table:filter.table,callback});return this;}
 subscribe(callback?:(status:string)=>void){void(async()=>{const app=await getApp(),config=await getClientConfiguration();if(!app||!config||this.closed)return;await getAuth(app).authStateReady();const db=getFirestore(app,config.firestoreDatabaseId);for(const w of this.watchers){let first=true;const u=onSnapshot(doc(db,'mudancas',w.table),()=>{if(first){first=false;return;}w.callback({eventType:'UPDATE',table:w.table});},()=>callback?.('CHANNEL_ERROR'));this.unsubs.push(u);}callback?.('SUBSCRIBED');})().catch(()=>callback?.('CHANNEL_ERROR'));return this;}
 unsubscribe(){this.closed=true;this.unsubs.forEach(u=>u());this.unsubs=[];}
}
export const firebase:FirebaseClient={
 auth,
 from(collection){return createQuery(async(request:QueryRequest)=>{try{return await requestApi({kind:'query',query:request});}catch(error){return {data:null,error,count:null};}},collection);},
 async rpc(name,args={}){try{return await requestApi({kind:'rpc',name,args});}catch(error){return {data:null,error};}},
 channel(){return new ChangeChannel();},async removeChannel(channel:ChangeChannel){channel.unsubscribe();return 'ok';},
 storage:{from(namespace:string){return {
  async createSignedUrls(paths:string[],seconds:number){try{return await requestApi({kind:'mediaUrls',namespace,paths,seconds});}catch(error){return {data:null,error};}},
  async createSignedUrl(path:string,seconds:number){try{const result=await requestApi({kind:'mediaUrls',namespace,paths:[path],seconds});return {data:result.data?.[0]??null,error:result.error};}catch(error){return {data:null,error};}},
  async upload(path:string,file:Blob,options?:{contentType?:string;upsert?:boolean}){try{
   const a=await authRequired();if(!a.currentUser)throw new Error('Entre novamente.');
   const response=await fetch(`/api/firebase/media-upload?namespace=${encodeURIComponent(namespace)}&path=${encodeURIComponent(path)}`,{method:'POST',headers:{Authorization:`Bearer ${await a.currentUser.getIdToken()}`,'Content-Type':options?.contentType||file.type||'application/octet-stream'},body:file});
   const result=await response.json();if(!response.ok)throw new Error(result.error?.message??'Não foi possível enviar o arquivo.');return result;
  }catch(error){return {data:null,error};}}
 };}},
};
