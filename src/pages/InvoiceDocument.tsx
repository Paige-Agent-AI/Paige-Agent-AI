import {useEffect,useRef,useState} from 'react';
import './invoice-document.css';
import {readCustomerPaymentRequest,customerPaymentRequestCopy,formatPaymentMinor,type CustomerPaymentRequest} from '@/solo/sales/customerPaymentRequest';
import {readInvoicePdf,downloadInvoicePdf} from '@/solo/sales/invoicePdf';
/** Public bearer document deliberately has no analytics, tenant shell or external resources. */
export default function InvoiceDocument(){
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
  return <main className="invoice-document-page">
    <div className="invoice-document-toolbar"><button disabled={!html||pdfBusy} onClick={()=>void download(true)}>Open PDF / print</button><button disabled={!html||pdfBusy} onClick={()=>void download()}>Download PDF</button>{pdfBusy&&<span role="status">Preparing PDF…</span>}</div>
    {html&&<section className="invoice-payment-request" aria-label="Invoice payment"><button disabled={paymentBusy} onClick={()=>void refreshPayment()}>{paymentBusy?'Checking payment status…':'Refresh payment status'}</button>{paymentNotice&&<p role="alert">{paymentNotice}</p>}{payment&&<><p role="status">{customerPaymentRequestCopy(payment.state)}</p><p>Outstanding balance: {formatPaymentMinor(payment.remainingMinor,payment.currency)}</p>{payment.url&&<><p>Requested payment: {formatPaymentMinor(payment.amountMinor,payment.currency)}</p><a href={payment.url} target="_blank" rel="noopener noreferrer">Continue to secure payment</a><p>Your payment provider handles payment details. Your invoice balance updates after confirmation.</p></>}</>}</section>}
    {pdfNotice&&<p role="alert">{pdfNotice}</p>}
    {error?<p role="alert">This invoice link is unavailable. Ask the business for a new link.</p>:html?<iframe ref={frame} title="Invoice document" sandbox="allow-same-origin allow-modals" srcDoc={html} style={{flex:1,minHeight:0,width:'100%',border:0}}/>:<p role="status">Opening invoice…</p>}
  </main>;
}
