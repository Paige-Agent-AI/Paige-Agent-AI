import React from 'react';
import {supabase} from '@/integrations/supabase/client';
import {AgreementPdfPage} from '@/solo/sales/AgreementPdfPage';
import {readRecipientFieldReply,recipientFieldAnswers,type RecipientFieldPacket,type RecipientFieldAnswer} from './recipientSigningFields';
import '@/solo/sales/agreement-document-fields.css';
import './recipient-signing.css';

export type ReviewedRecipientFields={packet:RecipientFieldPacket;answers:RecipientFieldAnswer[]};
type Props={token:string;busy:boolean;onLegacy:()=>void;onReady:(review:ReviewedRecipientFields|null)=>void;onContinue:()=>void;onCheck:()=>void};
type Source={packet:RecipientFieldPacket;bytes:Uint8Array};

/** One ordinary token-derived read, never an approval/signature or inferred
 * legacy fallback. Answers remain in RAM for this exact token/source only. */
export function RecipientAgreementDocument({token,busy,onLegacy,onReady,onContinue,onCheck}:Props){
 const [phase,setPhase]=React.useState<'loading'|'ready'|'failed'>('loading');
 const [source,setSource]=React.useState<Source|null>(null),[epoch,setEpoch]=React.useState(0);
 const [values,setValues]=React.useState<Record<string,string|boolean>>({});
 const sourceKey=React.useRef<string|null>(null),callbacks=React.useRef({onLegacy,onReady});callbacks.current={onLegacy,onReady};
 React.useEffect(()=>{
  let current=true;setPhase('loading');setSource(null);callbacks.current.onReady(null);
  void(async()=>{try{
   const reply=await supabase.functions.invoke('sign-agreement',{body:{token,action:'fields'}});
   if(!current)return;if(reply.error)throw new Error('unavailable');
   const packet=readRecipientFieldReply(reply.data);
   if(packet.kind==='legacy'){callbacks.current.onLegacy();return;}
   const document=await supabase.functions.invoke(`agreement-document?token=${encodeURIComponent(token)}`,{method:'GET'});
   if(!current)return;if(document.error||!(document.data instanceof Blob)||document.data.size!==packet.document.byte_length)throw new Error('unavailable');
   const bytes=new Uint8Array(await document.data.arrayBuffer());if(!current)return;
   const key=packet.preparation_id+':'+packet.preparation_sha256+':'+packet.document.sha256;
   if(sourceKey.current!==key){sourceKey.current=key;setValues({});}
   setSource({packet,bytes});setPhase('ready');
  }catch{if(current)setPhase('failed');}})();
  return()=>{current=false;callbacks.current.onReady(null);};
 },[token,epoch]);
 if(phase==='loading')return <section className="ags-doc ags-prepared-status" role="status">Checking the exact document and your assigned fields…</section>;
 if(phase==='failed'||!source)return <section className="ags-doc ags-prepared-status" role="alert">
  <h2>Your signing document is unavailable</h2><p>The exact document and your assigned fields could not be verified. Check the recorded status or ask the sender to verify it.</p>
  <div className="ags-review-recovery"><button type="button" className="ags-sign" disabled={busy} onClick={()=>setEpoch(e=>e+1)}>Try reading again</button><button type="button" className="ags-decline" disabled={busy} onClick={onCheck}>{busy?'Checking recorded status…':'Check recorded status'}</button></div>
  {busy&&<p role="status">Checking the existing record. No signature is being submitted.</p>}
 </section>;
 return <OwnRecipientFields key={sourceKey.current} source={source} values={values} setValues={setValues} busy={busy} onReady={onReady} onContinue={onContinue} onRetry={()=>setEpoch(e=>e+1)}/>;
}

function OwnRecipientFields({source:{packet,bytes},values,setValues,busy,onReady,onContinue,onRetry}:{source:Source;values:Record<string,string|boolean>;setValues:React.Dispatch<React.SetStateAction<Record<string,string|boolean>>>;busy:boolean;onReady:Props['onReady'];onContinue:Props['onContinue'];onRetry:()=>void}){
 const [page,setPage]=React.useState(1),[rendered,setRendered]=React.useState(false),[visited,setVisited]=React.useState<number[]>([]);
 const [reviewed,setReviewed]=React.useState(false),[selected,setSelected]=React.useState<string|null>(null);
 const [zoom,setZoom]=React.useState<'fit'|1|1.5|2>('fit'),[readingChanged,setReadingChanged]=React.useState(false);
 const renderGeneration=React.useRef(0),generation=renderGeneration.current;
 const root=React.useRef<HTMLElement>(null),readyCallback=React.useRef(onReady);readyCallback.current=onReady;
 const required=packet.fields.filter(f=>f.required&&['text','initials','checkbox'].includes(f.kind));
 const remaining=required.filter(f=>!Object.prototype.hasOwnProperty.call(values,f.id)||typeof values[f.id]==='string'&&!String(values[f.id]).trim()).length;
 const allPages=visited.length===packet.document.pages.length;
 const answers=React.useMemo(()=>{try{return recipientFieldAnswers(packet,values);}catch{return null;}},[packet,values]);
 const ready=rendered&&allPages&&answers!==null;
 React.useEffect(()=>{readyCallback.current(reviewed&&ready&&answers?{packet,answers}:null);},[reviewed,ready,packet,answers]);
 React.useEffect(()=>()=>readyCallback.current(null),[]);
 const edit=(id:string,value:string|boolean)=>{if(busy)return;setReviewed(false);setValues(v=>({...v,[id]:value}));};
 const changeView=(nextPage:number,nextZoom:typeof zoom=zoom)=>{
  if(busy||nextPage<1||nextPage>packet.document.pages.length||(nextPage===page&&nextZoom===zoom))return;
  renderGeneration.current++;setRendered(false);onReady(null);setPage(nextPage);setZoom(nextZoom);
  if(nextZoom!==zoom){setReviewed(false);setReadingChanged(true);}
 };
 const goTo=(id:string)=>{
  const field=packet.fields.find(f=>f.id===id);if(!field||busy)return;
  setSelected(id);changeView(field.page);requestAnimationFrame(()=>{const answer=root.current?.querySelector<HTMLElement>(`[data-field="${id}"]`);(answer?.querySelector<HTMLElement>('input')??answer)?.focus();});
 };
 return <section className="ags-prepared-document" ref={root} aria-label="Exact agreement and your assigned fields">
  <div className="ags-prepared-heading"><div><h2>Review your document</h2><p>Read every page, then complete the answers assigned to you.</p></div><span role="status">{visited.length} of {packet.document.pages.length} pages shown</span></div>
  <div className="ags-recipient-grid"><div className="ags-doc ags-recipient-paper">
   <nav className="ags-page-tools" aria-label="Document pages"><button type="button" disabled={busy||page===1} onClick={()=>changeView(page-1)}>Previous page</button><strong>Page {page} of {packet.document.pages.length}</strong><button type="button" disabled={busy||page===packet.document.pages.length} onClick={()=>changeView(page+1)}>Next page</button></nav>
   <div className="ags-reading-tools"><label>Zoom<select aria-label="Document zoom" value={zoom} disabled={busy} onChange={event=>{
    const value=event.target.value;if(!['fit','1','1.5','2'].includes(value))return;changeView(page,value==='fit'?'fit':Number(value) as 1|1.5|2);
   }}><option value="fit">Fit width</option><option value="1">100%</option><option value="1.5">150%</option><option value="2">200%</option></select></label>
    {zoom!=='fit'&&<button type="button" disabled={busy} onClick={()=>changeView(page,'fit')}>Fit width</button>}
   </div>
   {readingChanged&&<p className="ags-zoom-status" role="status">Zoom changed. Your answers are kept. Continue to signature when you are ready.</p>}
   <AgreementPdfPage key={zoom} bytes={bytes} document={packet.document} pageNumber={page} zoom={zoom} canView authorityKey={'recipient:'+packet.preparation_id} purpose="signing" onRetry={onRetry} onReady={result=>{
    if(generation!==renderGeneration.current)return;
    const valid=!!result&&result.sha256===packet.document.sha256&&result.page===page&&result.zoom===zoom;
    setRendered(valid);if(valid&&result)setVisited(p=>p.includes(result.page)?p:[...p,result.page]);
   }}>
    {packet.fields.filter(f=>f.page===page).map(f=><button type="button" key={f.id} className="ags-field-pin" disabled={busy} aria-label={'Show '+f.label+' in your answers'} data-selected={selected===f.id} style={{left:f.x/packet.document.pages[page-1].width*100+'%',top:f.y/packet.document.pages[page-1].height*100+'%',width:f.width/packet.document.pages[page-1].width*100+'%',height:f.height/packet.document.pages[page-1].height*100+'%'}} onClick={()=>goTo(f.id)}>{f.kind==='signed_date'?'Recorded on signing':f.kind==='signature'?'Your signature':values[f.id]===undefined?f.label:typeof values[f.id]==='boolean'?(values[f.id]?'✓':'—'):String(values[f.id])}</button>)}
   </AgreementPdfPage>
  </div><aside className="ags-recipient-answers" aria-label="Your answers" aria-busy={busy}>
   <header><h2>Your answers</h2><p>Only fields assigned to you are shown.</p><span role="status">{remaining?remaining+' required answers left':'Required answers complete'}</span></header>
   {packet.fields.map(f=><div key={f.id} className="ags-answer" data-field={f.id} data-selected={selected===f.id} role="group" aria-labelledby={'label-'+f.id} tabIndex={-1}>
    <div className="ags-answer-label">{f.kind==='text'||f.kind==='initials'?<label id={'label-'+f.id} htmlFor={'field-'+f.id}>{f.label}{f.required&&<span>Required</span>}</label>:<span id={'label-'+f.id} className="ags-readonly-label">{f.label}{f.required&&f.kind!=='signed_date'&&<span>Required</span>}</span>}<button type="button" disabled={busy} aria-label={'Go to '+f.label+' on page '+f.page} onClick={()=>{changeView(f.page);setSelected(f.id);}}>Page {f.page}</button></div>
    {f.kind==='text'||f.kind==='initials'?<input id={'field-'+f.id} autoComplete="off" disabled={busy} value={String(values[f.id]??'')} placeholder={f.kind==='initials'?'Your initials':'Enter your answer'} onChange={e=>edit(f.id,e.target.value)}/>:
     f.kind==='checkbox'?<fieldset disabled={busy}><legend className="sr-only">Choose the checkbox value for {f.label}</legend><label><input type="radio" name={f.id} checked={values[f.id]===true} onChange={()=>edit(f.id,true)}/>Checked</label><label><input type="radio" name={f.id} checked={values[f.id]===false} onChange={()=>edit(f.id,false)}/>Unchecked</label></fieldset>:
     f.kind==='signature'?<p>Your signature is added in the next step.</p>:<p>The recorded signing time supplies this date.</p>}
   </div>)}
   {!allPages&&<p className="ags-answer-guidance">Show all document pages before continuing.</p>}
   {!remaining&&answers===null&&<p className="ags-answer-guidance" role="alert">These answers could not be prepared. Shorten the answers or ask the sender for another signing method.</p>}
   <button type="button" className="ags-sign" disabled={busy||!ready} onClick={()=>{if(!answers)return;setReviewed(true);setReadingChanged(false);onReady({packet,answers});onContinue();}}>Continue to signature</button>
   <p className="ags-answer-foot">Answers stay on this page until you sign. Reviewing fields does not submit a signature or authorize a payment.</p>
  </aside></div>
 </section>;
}
