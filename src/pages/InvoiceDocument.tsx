import {useEffect,useRef,useState} from 'react';
import './invoice-document.css';
/** Public bearer document deliberately has no analytics, tenant shell or external resources. */
export default function InvoiceDocument(){
  const token=useRef(new URLSearchParams(window.location.search).get('token'));
  const [html,setHtml]=useState<string|null>(null);const [error,setError]=useState(false);
  const frame=useRef<HTMLIFrameElement>(null);
  useEffect(()=>{
    const controller=new AbortController();
    const meta=document.createElement('meta');meta.name='referrer';meta.content='no-referrer';document.head.append(meta);
    // Keep the bearer only in this mount's memory, never history/storage.
    window.history.replaceState(window.history.state,'',window.location.pathname);
    if(!token.current||!/^[0-9a-f]{64}$/.test(token.current)){setError(true);return()=>meta.remove();}
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sales-invoice-document?token=${encodeURIComponent(token.current)}`,{signal:controller.signal,cache:'no-store',referrerPolicy:'no-referrer',headers:{apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}})
      .then(async response=>{if(!response.ok)throw Error('Unavailable');setHtml(await response.text());})
      .catch(()=>{if(!controller.signal.aborted)setError(true);});
    return()=>{controller.abort();meta.remove();};
  },[]);
  const download=()=>{if(!html)return;const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='invoice.html';a.click();URL.revokeObjectURL(url);};
  return <main className="invoice-document-page">
    <div className="invoice-document-toolbar"><button disabled={!html} onClick={()=>frame.current?.contentWindow?.print()}>Print / save PDF</button><button disabled={!html} onClick={download}>Download invoice</button></div>
    {error?<p role="alert">This invoice link is unavailable. Ask the business for a new link.</p>:html?<iframe ref={frame} title="Invoice document" sandbox="allow-same-origin allow-modals" srcDoc={html} style={{flex:1,minHeight:0,width:'100%',border:0}}/>:<p role="status">Opening invoice…</p>}
  </main>;
}
