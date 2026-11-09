import {getInstallationConfig} from './config.server';
import {randomUUID} from 'node:crypto';
import {getDatabaseAccessToken,requestIdentity} from './identity.server';
import type {Store,StoreTransaction,Row,ListOptions,Filter} from './store-types';
export function encodeValue(value:any):any{
 if(value===null || value===undefined)return {nullValue:null};
 if(typeof value==='boolean')return {booleanValue:value};
 if(typeof value==='number')return Number.isInteger(value)?{integerValue:String(value)}:{doubleValue:value};
 if(typeof value==='string')return {stringValue:value};
 if(value instanceof Date)return {timestampValue:value.toISOString()};
 if(Array.isArray(value))return {arrayValue:{values:value.map(encodeValue)}};
 return {mapValue:{fields:encodeFields(value)}};
}
export function encodeFields(row:Row):Row{return Object.fromEntries(Object.entries(row).filter(([,v])=>v!==undefined).map(([k,v])=>[k,encodeValue(v)]));}
export function decodeValue(value:any):any{
 if('nullValue' in value)return null;
 for(const type of ['stringValue','booleanValue','doubleValue','timestampValue','referenceValue'])if(type in value)return value[type];
 if('integerValue'in value)return Number(value.integerValue);
 if('arrayValue'in value)return (value.arrayValue.values??[]).map(decodeValue);
 if('mapValue'in value)return decodeFields(value.mapValue.fields??{});
 return null;
}
export function decodeFields(fields:Row):Row{return Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,decodeValue(v)]));}
function safePart(value:string|number){const s=String(value);if(!s||s.includes('/')||s==='.'||s==='..')throw new Error('Identificador de documento inválido.');return s;}
export function filterToRest(f:Filter):any{
 const field={fieldPath:f.field};
 if(f.value===null&&(f.op==='eq'||f.op==='is'||f.op==='neq'))return {unaryFilter:{field,op:f.op==='neq'?'IS_NOT_NULL':'IS_NULL'}};
 const map={eq:'EQUAL',is:'EQUAL',neq:'NOT_EQUAL',gt:'GREATER_THAN',gte:'GREATER_THAN_OR_EQUAL',lt:'LESS_THAN',lte:'LESS_THAN_OR_EQUAL',in:'IN','not-in':'NOT_IN','array-contains':'ARRAY_CONTAINS'};
 return {fieldFilter:{field,op:map[f.op],value:encodeValue(f.value)}};
}
export function buildQuery(collection:string,options:ListOptions={}):Row{
 const filters=(options.filters??[]).map(filterToRest);
 if(options.or?.length)filters.push({compositeFilter:{op:'OR',filters:options.or.map(group=>group.length===1?filterToRest(group[0]!):{compositeFilter:{op:'AND',filters:group.map(filterToRest)}})}});
 const order=[...(options.order??[])];const ascending=order.at(-1)?.ascending!==false;
 const inequalities=[...new Set([...(options.filters??[]),...(options.or??[]).flat()].filter(f=>['neq','not-in','gt','gte','lt','lte'].includes(f.op)).map(f=>f.field))].sort();
 for(const field of inequalities)if(!order.some(term=>term.field===field))order.push({field,ascending});
 // Enterprise does not add stable document ordering automatically. Explicitly
 // preserve the Standard ordering for reliable pagination in both editions.
 if(!order.some(term=>term.field==='__name__'))order.push({field:'__name__',ascending});
 return {from:[{collectionId:safePart(collection)}],...(filters.length?{where:filters.length===1?filters[0]:{compositeFilter:{op:'AND',filters}}}:{}),orderBy:order.map(o=>({field:{fieldPath:o.field},direction:o.ascending===false?'DESCENDING':'ASCENDING'})),limit:Math.min(Math.max(options.limit??1000,1),1000),...(options.offset?{offset:Math.max(0,options.offset)}:{})};
}
function splitOptions(options:ListOptions):ListOptions[]|null{
 const filters=options.filters??[];
 const inFilters=filters.filter(f=>f.op==='in'&&Array.isArray(f.value));
 const large=inFilters.find(f=>f.value.length>30);
 if(large){const unique=[...new Set(large.value)];const parts:ListOptions[]=[];for(let index=0;index<unique.length;index+=30)parts.push({...options,filters:filters.map(f=>f===large?{...f,value:unique.slice(index,index+30)}:f)});return parts;}
 // Firestore limits the expanded disjunction to 30 terms, including IN x IN.
 if(inFilters.reduce((total,f)=>total*f.value.length,1)>30){const target=inFilters.find(f=>f.value.length>1)!;return target.value.map((value:any)=>({...options,filters:filters.map(f=>f===target?{...f,value:[value]}:f)}));}
 if(!options.or?.length)return null;
 const negatives=(filters:Filter[])=>filters.filter(f=>f.op==='neq'||f.op==='not-in').length;
 const mustSplit=negatives(filters)+options.or.reduce((n,group)=>n+negatives(group),0)>1 || filters.some(f=>f.op==='not-in'||f.op==='in') || options.or.some(group=>group.some(f=>f.op==='not-in'||f.op==='in'));
 if(!mustSplit)return null;
 const {or,...common}=options;
 return or.map(group=>({...common,filters:[...filters,...group]}));
}
function compareRows(a:Row,b:Row,order:ListOptions['order']){for(const term of order?.length?order:[{field:'id',ascending:true}]){const left=a[term.field],right=b[term.field];const delta=left===right?0:left==null?-1:right==null?1:left<right?-1:1;if(delta)return term.ascending===false?-delta:delta;}const tie=String(a['id']).localeCompare(String(b['id']));return order?.at(-1)?.ascending===false?-tie:tie;}
/** Operação recusada, para o log: método, rota e coleções gravadas. Nunca ids, valores nem credenciais. */
function descreverOperacao(method:string,suffix:string,body:unknown){
 const rota=suffix.startsWith(':')?suffix:suffix.split('/').slice(0,2).join('/');
 const writes=Array.isArray((body as any)?.writes)?(body as any).writes as any[]:[];
 const colecoes=writes.map(w=>String(w?.update?.name??w?.delete??'').split('/documents/')[1]?.split('/')[0]).filter(Boolean);
 const transacao=(body as any)?.transaction?' em transação':'';
 return `${method} ${rota}${transacao}${colecoes.length?` [${colecoes.join(', ')}]`:''}`;
}
export class FirestoreStore implements Store{
 /**
  * transacoes: 'servidor' usa :beginTransaction (identidade própria do serviço publicado, com IAM). 'otimista' é o
  * modo dos SDKs do Firebase no navegador: lê guardando a versão e grava com precondição. Sem identidade própria, o
  * servidor usa o login do usuário, e o Firestore real recusa :beginTransaction com PERMISSION_DENIED (o emulador
  * aceita). Padrão, seguindo getDatabaseAccessToken: com o login de alguém no pedido, 'otimista'; sem ninguém logado
  * (webhook, fila) ou com JANETE_RUNTIME_SERVICE_ACCOUNT, o banco é acessado pela identidade do serviço, que pode abrir
  * transação de servidor: 'servidor', com isolamento completo (a reserva da conversa evita resposta duplicada).
  */
 constructor(private accessToken:()=>Promise<string>=getDatabaseAccessToken, private transport:typeof fetch=fetch, private transacoes?:'servidor'|'otimista'){}
 private modoTransacao(){return this.transacoes??(process.env['JANETE_RUNTIME_SERVICE_ACCOUNT']||!requestIdentity.getStore()?.token?'servidor':'otimista');}
 private async base(){
  const c=await getInstallationConfig();const emulator=process.env['FIRESTORE_EMULATOR_HOST'];
  if(emulator){if(process.env['NODE_ENV']!=='test'||!c.projectId.startsWith('demo-')||! /^(127\.0\.0\.1|localhost):\d{2,5}$/.test(emulator))throw new Error('Emulador permitido somente em testes locais com projeto demo.');return `http://${emulator}/v1/projects/${c.projectId}/databases/${encodeURIComponent(c.firestoreDatabaseId)}/documents`;}
  return `https://firestore.googleapis.com/v1/projects/${c.projectId}/databases/${encodeURIComponent(c.firestoreDatabaseId)}/documents`;
 }
 private async request(suffix:string,body?:unknown,method=body===undefined?'GET':'POST'):Promise<any>{
  const ausenteVira404=suffix!==':commit';
  const token=await this.accessToken();const url=(await this.base())+suffix;
  const send=(credential:string)=>this.transport(url,{method,headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  const response=await send(token);
  if(response.status===404&&ausenteVira404)return null;
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(data?.error?.message??'Não foi possível concluir a operação no Firestore.'),{status:response.status,code:data?.error?.status,operacao:descreverOperacao(method,suffix,body)});
  return data;
 }
 private async docName(collection:string,id:string|number){return decodeURIComponent((await this.base()).replace(/^https?:\/\/[^/]+\/v1\//,''))+`/${safePart(collection)}/${safePart(id)}`;}
 private async getDocument(collection:string,id:string|number,transaction?:string):Promise<Row|null>{
  // batchGet carries the transaction in the request body and works consistently
  // with the Google REST service and the official local emulator.
  const batch=transaction?await this.request(':batchGet',{documents:[await this.docName(collection,id)],transaction}):null;
  const data=transaction?(Array.isArray(batch)?batch.find(item=>item.found)?.found:null):await this.request(`/${safePart(collection)}/${encodeURIComponent(safePart(id))}`);
  return data?{id:typeof id==='number'?id:decodeValue(data.fields?.id??{stringValue:String(id)}),...decodeFields(data.fields??{})}:null;
 }
 get(collection:string,id:string|number){return this.getDocument(collection,id);}
 private async listDocuments(collection:string,options:ListOptions={},transaction?:string):Promise<Row[]>{
  if((options.filters??[]).some(f=>f.op==='in'&&Array.isArray(f.value)&&!f.value.length))return [];
  const branches=splitOptions(options);
  if(branches){
   const merged=new Map<string,Row>();const needed=(options.offset??0)+Math.min(options.limit??1000,1000);
   for(const branch of branches){
    for(let offset=0;offset<needed;offset+=500){const page=await this.listDocuments(collection,{...branch,order:branch.order?.length?branch.order:[{field:'id',ascending:true}],limit:Math.min(500,needed-offset),offset},transaction);for(const row of page)merged.set(String(row['id']),row);if(page.length<Math.min(500,needed-offset))break;}
   }
   return [...merged.values()].sort((a,b)=>compareRows(a,b,options.order)).slice(options.offset??0,needed);
  }
  const data=await this.request(':runQuery',{structuredQuery:buildQuery(collection,options),...(transaction?{transaction}:{})});
  return (Array.isArray(data)?data:[]).filter(x=>x.document).map(x=>({id:x.document.name.split('/').pop(),...decodeFields(x.document.fields??{})}));
 }
 list(collection:string,options:ListOptions={}){return this.listDocuments(collection,options);}
 async count(collection:string,options:ListOptions={}):Promise<number>{
  if((options.filters??[]).some(f=>f.op==='in'&&Array.isArray(f.value)&&!f.value.length))return 0;
  if(splitOptions(options)){
   let total=0;for(let offset=0;;offset+=1000){const page=await this.listDocuments(collection,{...options,limit:1000,offset});total+=page.length;if(page.length<1000)return total;if(total>=10000)throw Object.assign(new Error('consulta_muito_ampla'),{code:'consulta_muito_ampla'});}
  }
  const structuredQuery=buildQuery(collection,options);delete structuredQuery['limit'];delete structuredQuery['offset'];delete structuredQuery['orderBy'];
  const data=await this.request(':runAggregationQuery',{structuredAggregationQuery:{structuredQuery,aggregations:[{alias:'total',count:{}}]}});
  const result=(Array.isArray(data)?data:[]).find(row=>row.result?.aggregateFields?.total);
  return result?Number(decodeValue(result.result.aggregateFields.total)):0;
 }
 private async write(collection:string,id:string|number,row:Row,merge=false){return {update:{name:await this.docName(collection,id),fields:encodeFields(row)},...(merge?{updateMask:{fieldPaths:Object.keys(row).filter(k=>row[k]!==undefined)}}:{})};}
 private async revision(collection:string){return this.write('mudancas',collection,{id:collection,revision:randomUUID(),updated_at:new Date().toISOString()});}
 async set(collection:string,id:string|number,row:Row,merge=false){await this.request(':commit',{writes:[await this.write(collection,id,row,merge),...(collection==='mudancas'?[]:[await this.revision(collection)])]});}
 async delete(collection:string,id:string|number){await this.request(':commit',{writes:[{delete:await this.docName(collection,id)},...(collection==='mudancas'?[]:[await this.revision(collection)])]});}
 async runTransaction<T>(fn:(tx:StoreTransaction)=>Promise<T>):Promise<T>{
  if(this.modoTransacao()==='otimista')return this.transacaoOtimista(fn);
  for(let attempt=0;attempt<5;attempt++){
   const begin=await this.request(':beginTransaction',{options:{readWrite:{}}});const transaction=begin.transaction;const writes:Row[]=[];const touched=new Set<string>();
   const tx:StoreTransaction={get:(c,id)=>this.getDocument(c,id,transaction),list:(c,o)=>this.listDocuments(c,o,transaction),set:async(c,id,row,merge)=>{writes.push(await this.write(c,id,row,merge));touched.add(c);},delete:async(c,id)=>{writes.push({delete:await this.docName(c,id)});touched.add(c);}};
   try{const result=await fn(tx);for(const collection of touched)if(collection!=='mudancas')writes.push(await this.revision(collection));await this.request(':commit',{transaction,writes});return result;}
   catch(error){await this.request(':rollback',{transaction}).catch(()=>{});if((error as any).code!=='ABORTED'||attempt===4)throw error;await new Promise(r=>setTimeout(r,20*(attempt+1)));}
  }
  throw new Error('A operação foi alterada por outra sessão. Tente novamente.');
 }
 /** Lê um documento guardando a versão (updateTime), ou null se não existe. */
 private async lerComVersao(collection:string,id:string|number){
  const data=await this.request(`/${safePart(collection)}/${encodeURIComponent(safePart(id))}`);
  const row=data?{id:typeof id==='number'?id:decodeValue(data.fields?.id??{stringValue:String(id)}),...decodeFields(data.fields??{})}:null;
  return {row,versao:data?.updateTime as string|undefined};
 }
 /**
  * Transação como os SDKs do Firebase fazem no navegador: lê guardando a versão de cada documento e grava num commit
  * com precondição (updateTime, ou exists:false para o que não existia). Se alguém alterou ou criou um desses
  * documentos no meio, o commit falha e tudo é refeito. Assim só o primeiro login vira dono, como no outro app AI PRO.
  * Leituras de listas não entram na precondição; com identidade própria, o modo 'servidor' tem isolamento completo.
  */
 private async transacaoOtimista<T>(fn:(tx:StoreTransaction)=>Promise<T>):Promise<T>{
  for(let attempt=0;attempt<5;attempt++){
   const lidos=new Map<string,string|null>();const writes:Row[]=[];const touched=new Set<string>();
   const tx:StoreTransaction={
    get:async(c,id)=>{const {row,versao}=await this.lerComVersao(c,id);const nome=await this.docName(c,id);if(!lidos.has(nome))lidos.set(nome,versao??null);return row;},
    list:(c,o)=>this.listDocuments(c,o),
    set:async(c,id,row,merge)=>{writes.push(await this.write(c,id,row,merge));touched.add(c);},
    delete:async(c,id)=>{writes.push({delete:await this.docName(c,id)});touched.add(c);},
   };
   try{
    const result=await fn(tx);
    if(!writes.length)return result;
    for(const collection of touched)if(collection!=='mudancas')writes.push(await this.revision(collection));
    for(const write of writes){const nome=write['update']?.name??write['delete'];if(nome&&lidos.has(nome)){const versao=lidos.get(nome);write['currentDocument']=versao?{updateTime:versao}:{exists:false};}}
    await this.request(':commit',{writes});
    return result;
   }catch(error){
    // Precondição falhou: alguém criou ou alterou um documento lido. Refaz com o estado novo.
    if(!['ALREADY_EXISTS','FAILED_PRECONDITION','NOT_FOUND','ABORTED'].includes((error as any)?.code)||attempt===4)throw error;
    await new Promise(r=>setTimeout(r,20*(attempt+1)));
   }
  }
  throw new Error('A operação foi alterada por outra sessão. Tente novamente.');
 }
}
export const firestoreStore=new FirestoreStore();
