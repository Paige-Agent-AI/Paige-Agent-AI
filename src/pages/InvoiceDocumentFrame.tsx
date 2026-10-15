import type {ReactNode,Ref} from 'react';
import './invoice-document.css';

/** One document presentation for bearer and actual linked-client authority. */
export function InvoiceDocumentFrame({html,error,pdfBusy,pdfNotice,download,frameRef,toolbar,children}:{
  html:string|null;error:string|null;pdfBusy:boolean;pdfNotice:string;
  download:(print:boolean)=>void;frameRef?:Ref<HTMLIFrameElement>;toolbar?:ReactNode;children?:ReactNode;
}){
  return <main className="invoice-document-page">
    <div className="invoice-document-toolbar">{toolbar}<button disabled={!html||pdfBusy} onClick={()=>download(true)}>Open PDF / print</button><button disabled={!html||pdfBusy} onClick={()=>download(false)}>Download PDF</button>{pdfBusy&&<span role="status">Preparing PDF…</span>}</div>
    {children}
    {pdfNotice&&<p role="alert">{pdfNotice}</p>}
    {error?<p role="alert">{error}</p>:html?<iframe ref={frameRef} title="Invoice document" sandbox="allow-same-origin allow-modals" srcDoc={html} style={{flex:1,minHeight:0,width:'100%',border:0}}/>:<p role="status">Opening invoice…</p>}
  </main>;
}
