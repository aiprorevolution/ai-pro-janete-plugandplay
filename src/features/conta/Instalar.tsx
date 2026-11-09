import {useState} from 'react';
import {Botao,Aviso} from '@/components/aipro';
import {CartaoConta,classesConta as s} from './CartaoConta';
// Mesma frase do outro app AI PRO validado no AI Studio: conecta o Firebase, publica as regras, reinicia e para.
export const INSTALL_PROMPT='Conecte o Firebase desta cópia e publique as regras do Firestore, seguindo o AGENTS.md.';
export function Instalar({erro}:{erro?:string}){
 const [copiado,setCopiado]=useState(false);
 return <CartaoConta idTitulo="instalar-titulo" titulo="Prepare sua AI PRO Janete" subtitulo="Conecte o Firebase da sua conta pelo agente do Google AI Studio.">
  <div className={s.form}>
   <p>1. Envie a instrução abaixo ao agente do AI Studio.</p>
   <p>2. Autorize o cartão de integração Firebase que ele apresentar.</p>
   <p>3. Volte aqui e entre com Google para configurar seu atendimento.</p>
   <textarea readOnly aria-label="Instrução para instalar a AI PRO Janete" value={INSTALL_PROMPT} rows={2} style={{width:'100%',padding:12,borderRadius:12,border:'1px solid var(--borda, #ddd)',fontSize:13}} />
   <Botao type="button" tamanho="grande" largo onClick={()=>void navigator.clipboard.writeText(INSTALL_PROMPT).then(()=>setCopiado(true))}>{copiado?'Instrução copiada':'Copiar instrução'}</Botao>
   <Botao type="button" variante="contorno" largo onClick={()=>window.location.reload()}>Já conectei, verificar novamente</Botao>
   {erro?<Aviso tom="erro" compacto>{erro}</Aviso>:null}
   <p className={s.rodape}>AI PRO Janete · Thiago Caliman</p>
  </div>
 </CartaoConta>;
}
