import type { Filter,ListOptions,Row,Store,StoreTransaction } from './store-types';

/** Isolated transactional test double. Production exclusively uses Firestore REST. */
export class MemoryStore implements Store {
  data=new Map<string,Row>();
  private queue:Promise<unknown>=Promise.resolve();
  constructor(rows:Record<string,Row[]>={}){for(const [c,rs]of Object.entries(rows))for(const r of rs)this.data.set(`${c}/${r['id']}`,structuredClone(r));}
  async get(c:string,id:string|number){return structuredClone(this.data.get(`${c}/${id}`)??null);}
  async set(c:string,id:string|number,row:Row,merge=false){this.data.set(`${c}/${id}`,structuredClone({...merge?this.data.get(`${c}/${id}`):{},...row}));}
  async delete(c:string,id:string|number){this.data.delete(`${c}/${id}`);}
  async list(c:string,options:ListOptions={}){
    const matches=(r:Row,f:Filter)=>{const v=f.field.split('.').reduce((a:any,k)=>a?.[k],r);switch(f.op){case'eq':case'is':return JSON.stringify(v??null)===JSON.stringify(f.value??null);case'neq':return v!==f.value;case'gt':return v!=null&&v>f.value;case'gte':return v!=null&&v>=f.value;case'lt':return v!=null&&v<f.value;case'lte':return v!=null&&v<=f.value;case'in':return f.value.includes(v);case'not-in':return!f.value.includes(v);case'array-contains':return Array.isArray(v)&&v.includes(f.value);}};
    const rows=[...this.data.entries()].filter(([k])=>k.startsWith(`${c}/`)).map(([,v])=>structuredClone(v)).filter(r=>(options.filters??[]).every(f=>matches(r,f))&&(!options.or||options.or.some(group=>group.every(f=>matches(r,f)))));
    rows.sort((a,b)=>{for(const o of options.order??[]){const x=a[o.field],y=b[o.field];if(x!==y)return(x==null?-1:y==null?1:x<y?-1:1)*(o.ascending===false?-1:1);}return String(a['id']).localeCompare(String(b['id']));});
    return rows.slice(options.offset??0,(options.offset??0)+Math.min(options.limit??1000,1000));
  }
  async runTransaction<T>(fn:(tx:StoreTransaction)=>Promise<T>):Promise<T>{
    const result=this.queue.then(async()=>{const candidate=new MemoryStore();candidate.data=structuredClone(this.data);const value=await fn(candidate);this.data=candidate.data;return value;});this.queue=result.catch(()=>{});return result;
  }
}
