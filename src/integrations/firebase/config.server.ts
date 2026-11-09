import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {normalizeConfig,type InstallationConfig} from './config';
/**
 * Endereço público do app: JANETE_PUBLIC_URL (instalador) ou, sem ele, o APP_URL que o Google AI Studio informa ao app
 * publicado. Endereços da prévia (ais-dev-…) e locais nunca valem: o WhatsApp não alcança.
 */
export function enderecoPublicoDoAmbiente():string|undefined{
 for(const valor of [process.env['JANETE_PUBLIC_URL'],process.env['APP_URL']]){
  if(!valor)continue;
  try{const url=new URL(valor);if(url.protocol==='https:'&&!/^(localhost|127\.|0\.|\[::1\])/.test(url.hostname)&&!/^ais-dev-|\.cloudworkstations\.dev$|\.run\.app\.googleusercontent\.com$/.test(url.hostname))return url.origin;}catch{/* valor inválido: ignora */}
 }
 return undefined;
}
function comEnderecoPublico():{publicUrl?:string}{const publicUrl=enderecoPublicoDoAmbiente();return publicUrl?{publicUrl}:{};}
export async function readInstallationConfig():Promise<InstallationConfig|null>{
 const serialized=process.env['JANETE_FIREBASE_CONFIG'];
 if(serialized){const config=normalizeConfig(JSON.parse(serialized));return config?{...config,...comEnderecoPublico(),...(process.env['JANETE_STORAGE_BUCKET']?{storageBucket:process.env['JANETE_STORAGE_BUCKET']}:{})}:null;}
 const filename=process.env['JANETE_FIREBASE_CONFIG_PATH']||path.resolve(process.cwd(),'firebase-applet-config.json');
 try{const config=normalizeConfig(JSON.parse(await readFile(filename,'utf8')));return config?{...config,...comEnderecoPublico(),...(process.env['JANETE_STORAGE_BUCKET']?{storageBucket:process.env['JANETE_STORAGE_BUCKET']}:{})}:null;}catch(error){
  if((error as NodeJS.ErrnoException).code==='ENOENT')return null;
  throw new Error('A configuração Firebase desta instalação não pôde ser lida. Confira firebase-applet-config.json.');
 }
}
export async function getInstallationConfig():Promise<InstallationConfig>{
 const config=await readInstallationConfig();
 if(!config)throw Object.assign(new Error('Conecte o Firebase pelo cartão nativo do Google AI Studio para iniciar a AI PRO Janete.'),{status:503,code:'firebase_not_configured'});
 return config;
}
