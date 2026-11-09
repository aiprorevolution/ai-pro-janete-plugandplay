import {firestoreStore} from './store.server';
import {currentActor} from './identity.server';
import type {Actor,Filter,Row,Store,ListOptions} from './store-types';
import {parseColumns,type QueryRequest,type QueryResult} from './query';
const MEMBER_COLLECTIONS=new Set(['membros','configuracao','etapas','contatos','contato_identificadores','contato_etapa_historico','conversas','mensagens','contexto_versoes','conversa_eventos','conexao_eventos','conexoes','ia_chaves','rodadas','ia_precos']);
const ADMIN_COLLECTIONS=new Set(['auditoria','convites','ia_chamadas']);
const SECRET_FIELDS=new Set(['segredos','chave_cifrada','parametros','webhook_token','token','secret','chave','master','senha']);
export function publicRow(row:Row,collection:string):Row{return Object.fromEntries(Object.entries(row).filter(([key])=>!SECRET_FIELDS.has(key)&&!(collection==='convites'&&key==='token_hash')));}
export async function requireMember(store:Store,actor:Actor|null){if(!actor||!actor.verified)throw Object.assign(new Error('Entre com uma conta de e-mail verificada.'),{status:403,code:'sem_acesso'});if(actor.system)return {id:'service',papel:'admin',ativo:true};const member=await store.get('membros',actor.uid);if(!member?.['ativo'])throw Object.assign(new Error('Sua conta não tem acesso a esta instalação.'),{status:403,code:'sem_acesso'});return member;}
function relationFor(collection:string,name:string,row:Row):{collection:string;id:any}|null{
 if(collection==='conversas'&&name==='contatos')return {collection:'contatos',id:row['contato_id']};
 if(collection==='conversas'&&name==='mensagens')return {collection:'mensagens',id:row['ultima_mensagem_id']};
 if(collection==='contatos'&&name==='etapas')return {collection:'etapas',id:row['etapa_id']};
 if(name==='membros')return {collection:'membros',id:row['membro_id']??row['autor_membro_id']??row['responsavel_id']};
 return null;
}
async function projectRow(store:Store,row:Row,collection:string,columns:string,remote:boolean):Promise<Row|null>{
 const source=remote?publicRow(row,collection):row;const result:Row={};
 for(const part of parseColumns(columns)){
  if(part==='*'){Object.assign(result,source);continue;}
  const joined=/^(?:(\w+):)?(\w+)(?:!([^()]+))?\((.*)\)$/.exec(part);
  if(joined){const [,alias,name,modifier,fields]=joined;const relation=relationFor(collection,name!,row);const related=relation?.id?await store.get(relation.collection,relation.id):null;if(modifier==='inner'&&!related)return null;result[alias??name!]=related?await projectRow(store,related,name!,fields!,remote):null;}
  else if(part in source)result[part]=source[part];
 }
 return result;
}
export function validateQuery(q:any):asserts q is QueryRequest{
 if(!q||typeof q!=='object'||typeof q.collection!=='string'||!['select','insert','upsert','update','delete'].includes(q.operation)||typeof q.columns!=='string'||q.columns.length>12000||!q.options||typeof q.options!=='object')throw Object.assign(new Error('Consulta inválida.'),{status:400});
 if(q.options.limit!==undefined&&(!Number.isInteger(q.options.limit)||q.options.limit<1||q.options.limit>1000))throw Object.assign(new Error('A página deve ter entre 1 e 1.000 registros.'),{status:400});
 if(q.options.offset!==undefined&&(!Number.isInteger(q.options.offset)||q.options.offset<0))throw Object.assign(new Error('Página inválida.'),{status:400});
 const all=[...(q.options.filters??[]),...(q.options.or??[]).flat()];
 if(all.length>50||all.some((f:any)=>!f||typeof f.field!=='string'||!/^\w+(?:\.\w+)?$/.test(f.field)||!['eq','neq','gt','gte','lt','lte','in','not-in','array-contains','is'].includes(f.op)))throw Object.assign(new Error('Filtros inválidos.'),{status:400});
}
async function readRows(store:Store,q:QueryRequest):Promise<Row[]>{
 if(q.collection==='membros'&&q.options.filters?.length===1){const filter=q.options.filters[0]!;if((filter.field==='id'||filter.field==='user_id')&&filter.op==='eq'){const row=await store.get('membros',filter.value);return row?[row]:[];}}
 const related=(q.options.filters??[]).filter(f=>f.field.startsWith('contatos.'));
 let options:ListOptions={...q.options};
 if(related.length){
  if(q.collection!=='conversas')throw new Error('Relação de consulta inválida.');
  const contacts:Row[]=[];for(let offset=0;;offset+=1000){const page=await store.list('contatos',{filters:related.map(f=>({...f,field:f.field.slice(9)})),limit:1000,offset});contacts.push(...page);if(page.length<1000)break;}
  if(!contacts.length)return [];
  const filters=(options.filters??[]).filter(f=>!f.field.startsWith('contatos.'));
  const rows:Row[]=[];
  for(let i=0;i<contacts.length;i+=30){const ids=contacts.slice(i,i+30).map(r=>r['id']);for(let offset=0;;offset+=1000){const page=await store.list(q.collection,{filters:[...filters,{field:'contato_id',op:'in',value:ids}],...(options.or?{or:options.or}:{}),limit:1000,offset});rows.push(...page);if(page.length<1000)break;}}
  rows.sort((a,b)=>{for(const order of options.order??[]){const av=a[order.field],bv=b[order.field];const c=av===bv?0:av==null?-1:bv==null?1:av<bv?-1:1;if(c)return order.ascending===false?-c:c;}return 0;});
  return q.head?rows:rows.slice(options.offset??0,(options.offset??0)+(options.limit??1000));
 }
 // The REST store divides IN/OR queries at the Firestore boundary and applies
 // ordering, deduplication and pagination to the complete union.
 if((options.filters??[]).some(f=>f.op==='in'&&Array.isArray(f.value)&&!f.value.length))return [];
 return store.list(q.collection,options);
}
export async function executeQuery(q:QueryRequest,{store=firestoreStore,actor=currentActor(),remote=false}:{store?:Store;actor?:Actor|null;remote?:boolean}={}):Promise<QueryResult>{
 try{
  validateQuery(q);
  if(remote){
   const selfQuery=q.collection==='membros'&&q.operation==='select'&&(q.options.filters??[]).some(f=>(f.field==='user_id'||f.field==='id')&&f.op==='eq'&&f.value===actor?.uid);
   if(!selfQuery){const member=await requireMember(store,actor);if(!MEMBER_COLLECTIONS.has(q.collection)&&!(member['papel']==='admin'&&ADMIN_COLLECTIONS.has(q.collection)))throw Object.assign(new Error('Sem acesso a estes dados.'),{status:403,code:'sem_acesso'});}
  }
  const canAggregate=q.operation==='select'&&q.count&&!(q.options.filters??[]).some(f=>f.field.includes('.'))&&'count'in store;
  const aggregatedCount=canAggregate?await (store as Store&{count:(c:string,o:ListOptions)=>Promise<number>}).count(q.collection,q.options):null;
  if(q.head&&canAggregate)return {data:null,error:null,count:aggregatedCount};
  let rows:Row[];
  if(q.operation!=='select'){
   const {applyMutation}=await import('./rpc-mutations');
   rows=await applyMutation({store,actor,collection:q.collection,operation:q.operation,...(q.values?{values:q.values}:{}),options:q.options});
  }else rows=await readRows(store,q);
  const count=q.count?(aggregatedCount??rows.length):null;
  if(q.head)return {data:null,error:null,count};
  const projected=(await Promise.all(rows.map(row=>projectRow(store,row,q.collection,q.columns,remote)))).filter((row):row is Row=>row!==null);
  if(q.single){if(projected.length>1||(q.single==='one'&&!projected.length))throw Object.assign(new Error('A consulta não encontrou exatamente um registro.'),{code:'PGRST116'});return {data:projected[0]??null,error:null,count};}
  return {data:projected,error:null,count};
 }catch(error){return {data:null,error,count:null};}
}
