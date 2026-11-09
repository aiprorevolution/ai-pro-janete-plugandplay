export interface InstallationConfig {
 projectId:string; apiKey:string; authDomain:string; appId:string;
 firestoreDatabaseId:string; storageBucket:string; publicUrl?:string;
}
export function normalizeConfig(input: unknown):InstallationConfig|null {
 if(!input || typeof input!=='object') return null;
 const raw=input as Record<string,unknown>;
 const source=(raw['firebaseConfig'] && typeof raw['firebaseConfig']==='object' ? raw['firebaseConfig'] : raw) as Record<string,unknown>;
 const str=(name:string)=> typeof source[name]==='string' ? (source[name] as string).trim() : '';
 const projectId=str('projectId'),apiKey=str('apiKey'),appId=str('appId');
 if(!projectId || !apiKey || !appId || /YOUR_|REPLACE_|placeholder|<|>/i.test(projectId+apiKey+appId))return null;
 if(!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId))throw new Error('O projectId do Firebase é inválido.');
 const database=String(raw['firestoreDatabaseId']??source['firestoreDatabaseId']??raw['databaseId']??'(default)');
 if(!/^(\(default\)|[a-zA-Z0-9_-]{1,100})$/.test(database))throw new Error('O banco nomeado do Firestore é inválido.');
 const publicUrl=typeof raw['publicUrl']==='string' ? raw['publicUrl'] : undefined;
 return {projectId,apiKey,appId,authDomain:str('authDomain')||`${projectId}.firebaseapp.com`,firestoreDatabaseId:database,storageBucket:str('storageBucket'),...(publicUrl?{publicUrl}:{} )};
}
