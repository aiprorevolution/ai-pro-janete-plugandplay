/** Contrato de persistência. A implementação de produção usa Firestore REST. */
export type Row = Record<string, any>;
export type Actor = { uid: string; email?: string; name?: string; verified: boolean; system?: boolean; role?: string; provider?:string };
export type Filter = { field: string; op: 'eq'|'neq'|'gt'|'gte'|'lt'|'lte'|'in'|'not-in'|'array-contains'|'is'; value: any };
export type ListOptions = { filters?: Filter[]; or?: Filter[][]; order?: {field:string;ascending?:boolean}[]; limit?:number; offset?:number };
export interface StoreTransaction {
 get(collection:string,id:string|number):Promise<Row|null>;
 list(collection:string,options?:ListOptions):Promise<Row[]>;
 set(collection:string,id:string|number,data:Row,merge?:boolean):Promise<void>;
 delete(collection:string,id:string|number):Promise<void>;
}
export interface Store extends StoreTransaction {
 runTransaction<T>(fn:(transaction:StoreTransaction)=>Promise<T>):Promise<T>;
}
export type RpcContext = { store:Store; actor:Actor|null };
