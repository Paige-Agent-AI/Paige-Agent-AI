import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import './invoice-document.css';
import {readCustomerPaymentRequest,type CustomerPaymentRequest} from '@/solo/sales/customerPaymentRequest';
import {readInvoicePdf,downloadInvoicePdf} from '@/solo/sales/invoicePdf';
import {InvoiceDocumentFrame} from './InvoiceDocumentFrame';
import {InvoicePaymentRequestView} from './InvoicePaymentRequestView';
const ClientScopedInvoiceDocument=lazy(()=>import('./ClientScopedInvoiceDocument'));
export default function InvoiceDocument(){
  const source=useRef(new URLSearchParams(window.location.search));
  if(source.current.has('client_id')&&!source.current.has('token'))return <Suspense fallback={<p role="status">Opening invoice…</p>}><ClientScopedInvoiceDocument target={{tenantId:source.current.get('tenant_id')??'',clientId:source.current.get('client_id')??'',invoiceId:source.current.get('invoice_id')??''}}/></Suspense>;
  return <BearerInvoiceDocument/>;
}
/** Public bearer document deliberately has no analytics, tenant shell or external resources. */
function BearerInvoiceDocument(){
  const token=useRef(new URLSearchParams(window.location.search).get('token'));
  const [html,setHtml]=useState<string|null>(null);const [error,setError]=useState(false);
  const frame=useRef<HTMLIFrameElement>(null);
  const [payment,setPayment]=useState<CustomerPaymentRequest|null>(null),[paymentBusy,setPaymentBusy]=useState(false),[paymentNotice,setPaymentNotice]=useState('');
  const paymentEpoch=useRef(0);
  const refreshPayment=async()=>{if(!token.current)return;const epoch=++paymentEpoch.current;setPaymentBusy(true);setPayment(null);setPaymentNotice('');try{const response=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sales-invoice-document?token=${encodeURIComponent(token.current)}&format=payment-request`,{cache:'no-store',referrerPolicy:'no-referrer',headers:{apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}});if(!response.ok)throw Error('Unavailable');const value=readCustomerPaymentRequest(await response.json());if(alive.current&&epoch===paymentEpoch.current)setPayment(value);}catch{if(alive.current&&epoch===paymentEpoch.current)setPaymentNotice('Payment status could not be checked. Retry or contact the business.');}finally{if(alive.current&&epoch===paymentEpoch.current)setPaymentBusy(false);}};
  const [pdfBusy,setPdfBusy]=useState(false),[pdfNotice,setPdfNotice]=useState('');
  const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
  useEffect(()=>{
    const controller=new AbortController();
    const meta=document.createElement('meta');meta.name='referrer';meta.content='no-referrer';document.head.append(meta);
    // Keep the bearer only in this mount's memory, never history/storage.
    window.history.replaceState(window.history.state,'',window.location.pathname);
    if(!token.current||!/^[0-9a-f]{64}$/.test(token.current)){setError(true);return()=>meta.remove();}
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sales-invoice-document?token=${encodeURIComponent(token.current)}`,{signal:controller.signal,cache:'no-store',referrerPolicy:'no-referrer',headers:{apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}})
      .then(async response=>{if(!response.ok)throw Error('Unavailable');setHtml(await response.text());void refreshPayment();})
      .catch(()=>{if(!controller.signal.aborted)setError(true);});
    return()=>{controller.abort();meta.remove();};
  },[]);
  const download=async(print=false)=>{if(!html||pdfBusy||!token.current)return;const popup=print?window.open('about:blank','_blank'):null;if(popup)popup.opener=null;setPdfBusy(true);setPdfNotice('');try{const blob=await readInvoicePdf(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sales-invoice-document?token=${encodeURIComponent(token.current)}&format=pdf`,{apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY});if(!alive.current){popup?.close();return;}if(print){if(!popup)throw Error('POPUP_BLOCKED');const url=URL.createObjectURL(blob);popup.location.replace(url);setTimeout(()=>URL.revokeObjectURL(url),60000);}else downloadInvoicePdf(blob,'document');}catch{popup?.close();if(alive.current)setPdfNotice('PDF could not be opened. Retry, or allow the PDF window to open.');}finally{if(alive.current)setPdfBusy(false);}};
  return <InvoiceDocumentFrame html={html} error={error?'This invoice link is unavailable. Ask the business for a new link.':null} pdfBusy={pdfBusy} pdfNotice={pdfNotice} download={print=>void download(print)} frameRef={frame}>
    {html&&<InvoicePaymentRequestView payment={payment} busy={paymentBusy} notice={paymentNotice} refresh={()=>void refreshPayment()}/>}
  </InvoiceDocumentFrame>;
}
