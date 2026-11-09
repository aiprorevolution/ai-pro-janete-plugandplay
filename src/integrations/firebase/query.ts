import type {Filter,ListOptions,Row} from './store-types';
export interface QueryRequest {collection:string;operation:'select'|'insert'|'upsert'|'update'|'delete';columns:string;values?:Row|Row[];options:ListOptions;single?:'one'|'maybe';count?:boolean;head?:boolean;onConflict?:string}
export interface QueryResult<T=any>{data:T|null;error:any;count:number|null}
export type ExecuteQuery=(request:QueryRequest)=>Promise<QueryResult>;
/** Interface de consultas usada pelas telas; o transporte é Firestore real. */
export class QueryBuilder<T=any> implements PromiseLike<QueryResult<T>>{
 constructor(private execute:ExecuteQuery,readonly request:QueryRequest){}
 select(columns='*',options?:{count?:string;head?:boolean}){this.request.columns=columns;if(options?.count)this.request.count=true;if(options?.head)this.request.head=true;return this;}
 insert(values:Row|Row[]){this.request.operation='insert';this.request.values=values;return this;}
 upsert(values:Row|Row[],options?:{onConflict?:string;ignoreDuplicates?:boolean}){this.request.operation='upsert';this.request.values=values;if(options?.onConflict)this.request.onConflict=options.onConflict;return this;}
 update(values:Row){this.request.operation='update';this.request.values=values;return this;}
 delete(){this.request.operation='delete';return this;}
 private where(field:string,op:Filter['op'],value:any){(this.request.options.filters??=[]).push({field,op,value});return this;}
 eq(f:string,v:any){return this.where(f,'eq',v)} neq(f:string,v:any){return this.where(f,'neq',v)} gt(f:string,v:any){return this.where(f,'gt',v)} gte(f:string,v:any){return this.where(f,'gte',v)} lt(f:string,v:any){return this.where(f,'lt',v)} lte(f:string,v:any){return this.where(f,'lte',v)} is(f:string,v:any){return this.where(f,'is',v)} in(f:string,v:any[]){return this.where(f,'in',v)}
 not(field:string,op:string,value:any){return this.where(field,op==='in'?'not-in':'neq',op==='in'&&typeof value==='string'?value.replace(/^\(|\)$/g,'').split(','):value);}
 or(value:string){this.request.options.or=parseOr(value);return this;}
 order(field:string,options?:{ascending?:boolean;nullsFirst?:boolean;referencedTable?:string}){(this.request.options.order??=[]).push({field,ascending:options?.ascending!==false});return this;}
 limit(limit:number){this.request.options.limit=limit;return this;}
 range(start:number,end:number){this.request.options.offset=start;this.request.options.limit=end-start+1;return this;}
 single(){this.request.single='one';return this as unknown as QueryBuilder<T extends (infer R)[]?R:T>}
 maybeSingle(){this.request.single='maybe';return this as unknown as QueryBuilder<T extends (infer R)[]?R:T>}
 returns<U>(){return this as unknown as QueryBuilder<U>}
 throwOnError(){return this;}
 then<TResult1=QueryResult<T>,TResult2=never>(onfulfilled?:((value:QueryResult<T>)=>TResult1|PromiseLike<TResult1>)|null,onrejected?:((reason:any)=>TResult2|PromiseLike<TResult2>)|null):PromiseLike<TResult1|TResult2>{return this.execute(this.request).then(onfulfilled,onrejected);}
}
export function createQuery(execute:ExecuteQuery,collection:string){return new QueryBuilder<any>(execute,{collection,operation:'select',columns:'*',options:{}});}
function split(value:string){let depth=0,start=0,quoted=false;const parts:string[]=[];for(let i=0;i<value.length;i++){if(value[i]==='"'&&value[i-1]!=='\\')quoted=!quoted;if(quoted)continue;if(value[i]==='(')depth++;if(value[i]===')')depth--;if(value[i]===','&&depth===0){parts.push(value.slice(start,i));start=i+1;}}parts.push(value.slice(start));return parts;}
export function parseOr(value:string):Filter[][]{
 return split(value).map(term=>{const and=term.startsWith('and(')&&term.endsWith(')');return (and?split(term.slice(4,-1)):[term]).map(part=>{const match=/^([\w.]+?)\.(not\.)?(eq|neq|is|gt|gte|lt|lte|in)\.(.*)$/.exec(part);if(!match)throw new Error('Filtro de consulta inválido.');const [,field,negation,operator,raw]=match;let v:any=raw==='null'?null:raw==='true'?true:raw==='false'?false:raw;if(raw?.startsWith('"')&&raw.endsWith('"'))v=JSON.parse(raw);let op=operator as Filter['op'];if(op==='in')v=split(raw!.replace(/^\(|\)$/g,''));if(negation)op=op==='in'?'not-in':'neq';return {field:field!,op,value:v};});});
}
export function parseColumns(columns:string){return split(columns).map(s=>s.trim()).filter(Boolean);}
