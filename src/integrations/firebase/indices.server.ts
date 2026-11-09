import especificacao from '../../../firestore.indexes.json';

/**
 * Índices compostos do Firestore criados pelo próprio app publicado, com a identidade do serviço, sem o instalador.
 * Mesma validação e comparação do instalador (scripts/configurar-google.mjs), mas sem esperar cada índice ficar pronto:
 * cria os que faltam e informa a situação. O Google leva alguns minutos para construir cada um.
 */
export type Api=(url:string,init?:{method?:string;body?:unknown})=>Promise<any>;
export type SituacaoIndices={exigidos:number;prontos:number;criando:number;faltando:number;criadosAgora:number};
type Campo={fieldPath:string;order?:string;arrayConfig?:string};
type Indice={collectionGroup:string;queryScope:string;apiScope?:string;density?:string;fields:Campo[]};

function corpoDoIndice(indice:Indice,edicao:string){
 if(!indice||!/^[a-zA-Z0-9_-]+$/.test(indice.collectionGroup||'')||!['COLLECTION','COLLECTION_GROUP'].includes(indice.queryScope)||
    !Array.isArray(indice.fields)||indice.fields.length<2||indice.fields.length>100)throw new Error('indice_invalido');
 if(indice.apiScope&&indice.apiScope!=='ANY_API')throw new Error('indice_invalido');
 const fields:Campo[]=indice.fields.map(campo=>{
  if(!campo||typeof campo.fieldPath!=='string'||!campo.fieldPath||Number(Boolean(campo.order))+Number(Boolean(campo.arrayConfig))!==1||
     (campo.order&&!['ASCENDING','DESCENDING'].includes(campo.order))||(campo.arrayConfig&&campo.arrayConfig!=='CONTAINS'))throw new Error('indice_invalido');
  return campo.order?{fieldPath:campo.fieldPath,order:campo.order}:{fieldPath:campo.fieldPath,arrayConfig:String(campo.arrayConfig)};
 });
 const density=indice.density||(edicao==='ENTERPRISE'?'SPARSE_ANY':'SPARSE_ALL');
 return {queryScope:indice.queryScope,apiScope:'ANY_API',density,fields};
}
/** Chave de comparação: o Google acrescenta __name__ no fim; os dois lados são normalizados igual. */
function chaveDoIndice(indice:Indice,edicao:string){
 const corpo=corpoDoIndice({...indice,collectionGroup:'comparacao'},edicao);
 if(corpo.fields.at(-1)?.fieldPath!=='__name__')corpo.fields.push({fieldPath:'__name__',order:corpo.fields.at(-1)?.order||'ASCENDING'});
 return JSON.stringify(corpo);
}

export async function situacaoDosIndices(api:Api,projeto:{projectId:string;databaseId:string},criar:boolean,
 indices:Indice[]=(especificacao as {indexes:Indice[]}).indexes):Promise<SituacaoIndices>{
 const banco=`projects/${projeto.projectId}/databases/${encodeURIComponent(projeto.databaseId)}`;
 const meta=await api(`https://firestore.googleapis.com/v1/${banco}`);
 const edicao=meta?.databaseEdition==='ENTERPRISE'?'ENTERPRISE':'STANDARD';
 const esperados=indices.map(indice=>({grupo:indice.collectionGroup,corpo:corpoDoIndice(indice,edicao),chave:chaveDoIndice(indice,edicao)}));
 const existentes=new Map<string,any[]>();
 const listar=async(grupo:string)=>{
  const lista:any[]=[];let proxima='';
  do{const r=await api(`https://firestore.googleapis.com/v1/${banco}/collectionGroups/${encodeURIComponent(grupo)}/indexes?pageSize=100${proxima?`&pageToken=${encodeURIComponent(proxima)}`:''}`);lista.push(...(r?.indexes??[]));proxima=r?.nextPageToken??'';}while(proxima);
  return lista;
 };
 const situacao:SituacaoIndices={exigidos:esperados.length,prontos:0,criando:0,faltando:0,criadosAgora:0};
 for(const esperado of esperados){
  if(!existentes.has(esperado.grupo))existentes.set(esperado.grupo,await listar(esperado.grupo));
  const achado=existentes.get(esperado.grupo)!.find(candidato=>{try{return chaveDoIndice(candidato,edicao)===esperado.chave;}catch{return false;}});
  if(achado){if(achado.state==='READY')situacao.prontos++;else situacao.criando++;continue;}
  if(!criar){situacao.faltando++;continue;}
  try{await api(`https://firestore.googleapis.com/v1/${banco}/collectionGroups/${encodeURIComponent(esperado.grupo)}/indexes`,{method:'POST',body:esperado.corpo});situacao.criadosAgora++;situacao.criando++;}
  catch(error){if((error as any)?.status===409){situacao.criando++;continue;}throw error;}
 }
 return situacao;
}

/** Chamada à API do Google com a identidade do serviço; erro leva status e código, nunca o corpo. */
export function apiComToken(token:string):Api{
 return async(url,init={})=>{
  const resposta=await fetch(url,{method:init.method??'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(init.body!==undefined?{body:JSON.stringify(init.body)}:{}),signal:AbortSignal.timeout(15000)});
  const dados=await resposta.json().catch(()=>({}));
  if(!resposta.ok)throw Object.assign(new Error('google_api_recusou'),{status:resposta.status,code:dados?.error?.status});
  return dados;
 };
}
