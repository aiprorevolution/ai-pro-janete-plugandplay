import type {QueryBuilder} from './query';
import type {Database} from './types';
export type TableName=keyof Database['public']['Tables'];
export type TableRow<K extends TableName>=Database['public']['Tables'][K]['Row'];
export interface User {id:string;email?:string;email_confirmed_at?:string;user_metadata:Record<string,any>;identities?:any[];created_at?:string}
export interface Session {access_token:string;user:User;expires_at?:number}
export type AuthEvent='SIGNED_IN'|'SIGNED_OUT'|'USER_UPDATED'|'TOKEN_REFRESHED'|'INITIAL_SESSION';
export interface AuthFacade{
 getSession:()=>Promise<{data:{session:Session|null};error:any}>;
 getUser:()=>Promise<{data:{user:User|null};error:any}>;
 signInWithPassword:(input:{email:string;password:string})=>Promise<{data:{user:User|null;session:Session|null};error:any}>;
 signInWithGoogle:()=>Promise<{data:{user:User|null;session:Session|null};error:any}>;
 signUp:(input:{email:string;password:string;options?:{data?:Record<string,any>;emailRedirectTo?:string}})=>Promise<{data:{user:User|null;session:Session|null};error:any}>;
 signOut:(options?:{scope?:string})=>Promise<{error:any}>;
 resetPasswordForEmail:(email:string,options?:{redirectTo?:string})=>Promise<{error:any}>;
 updateUser:(input:{password?:string;data?:Record<string,any>})=>Promise<{data:{user:User|null};error:any}>;
 onAuthStateChange:(callback:(event:AuthEvent,session:Session|null)=>void)=>{data:{subscription:{unsubscribe:()=>void}}};
}
export interface FirebaseClient<T=unknown>{
 from:<K extends TableName>(collection:K)=>QueryBuilder<TableRow<K>[]>;
 rpc:(name:string,args?:any)=>Promise<{data:any;error:any;count?:number|null}>;
 auth:AuthFacade;
 channel:(name:string)=>any;
 removeChannel:(channel:any)=>Promise<any>;
 storage:any;
}
