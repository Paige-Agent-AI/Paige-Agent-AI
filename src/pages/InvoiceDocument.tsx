import {useCallback,useEffect,useRef,useState} from 'react';
import './invoice-document.css';
import {readCustomerInvoiceFinancialStatus,readCustomerDocumentFinancialContext,matchesCustomerDocumentFinancialContext,customerPaymentRequestCopy,formatPaymentMinor,type CustomerInvoiceFinancialStatus,type CustomerDocumentFinancialContext} from '@/solo/sales/customerPaymentRequest';
import {readInvoicePdf,downloadInvoicePdf} from '@/solo/sales/invoicePdf';
const readOptions={cache:'no-store' as const,referrerPolicy:'no-referrer' as const,headers:{apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}};
/** Public bearer document deliberately has no analytics, tenant shell or external resources. */
export default function InvoiceDocument(){
 const token=useRef(new URLSearchParams(window.location.search).get('token'));
 const [html,setHtml]=useState<string|null>(null),[error,setError]=useState(false),[outdated,setOutdated]=useState(false);
 const [financial,setFinancial]=useState<CustomerInvoiceFinancialStatus|null>(null),[paymentBusy,setPaymentBusy]=useState(false),[paymentNotice,setPaymentNotice]=useState('');
 const [pdfBusy,setPdfBusy]=useState(false),[pdfNotice,setPdfNotice]=useState('');
 const alive=useRef(true),paymentEpoch=useRef(0),documentEpoch=useRef(0),documentAbort=useRef<AbortController|null>(null);
 const documentContext=useRef<CustomerDocumentFinancialContext|null>(null);
 const payment=financial?.request??null,summary=financial?.summary;
 const endpoint=useCallback(()=>import.meta.env.VITE_SUPABASE_URL+'/functions/v1/sales-invoice-document?token='+encodeURIComponent(token.current??''),[]);

 const refreshPayment=useCallback(async()=>{
  if(!token.current||!documentContext.current)return;
  const epoch=++paymentEpoch.current,context=documentContext.current;setPaymentBusy(true);setFinancial(null);setPaymentNotice('');
  try{
   const response=await fetch(endpoint()+'&format=payment-request',readOptions);if(!response.ok)throw Error('Unavailable');
   const value=readCustomerInvoiceFinancialStatus(await response.json());if(!value)throw Error('Unavailable');
   if(!alive.current||epoch!==paymentEpoch.current||documentContext.current!==context)return;
   if(!matchesCustomerDocumentFinancialContext(value.summary,context)){
    setOutdated(true);setPaymentNotice('This invoice changed. Refresh the document before using a payment link.');return;
   }
   setFinancial(value);
  }catch{if(alive.current&&epoch===paymentEpoch.current)setPaymentNotice('Payment status could not be checked. Retry or contact the business.');}
  finally{if(alive.current&&epoch===paymentEpoch.current)setPaymentBusy(false);}
 },[endpoint]);
 const refreshDocument=useCallback(async()=>{
  if(!token.current)return;documentAbort.current?.abort();
  const controller=new AbortController(),epoch=++documentEpoch.current;documentAbort.current=controller;
  ++paymentEpoch.current;documentContext.current=null;setHtml(null);setFinancial(null);setPaymentBusy(false);setPaymentNotice('');setPdfNotice('');setError(false);setOutdated(false);
  try{
   const response=await fetch(endpoint(),{...readOptions,signal:controller.signal});if(!response.ok)throw Error('Unavailable');
   const context=readCustomerDocumentFinancialContext(response.headers.get('X-PAIGE-Invoice-Financial-Context'));if(!context)throw Error('Unavailable');
   const text=await response.text();if(!alive.current||epoch!==documentEpoch.current)return;
   documentContext.current=context;setHtml(text);void refreshPayment();
  }catch{if(!controller.signal.aborted&&alive.current&&epoch===documentEpoch.current)setError(true);}
 },[endpoint,refreshPayment]);
 useEffect(()=>{
  alive.current=true;const documentGeneration=documentEpoch,paymentGeneration=paymentEpoch;
  const meta=document.createElement('meta');meta.name='referrer';meta.content='no-referrer';document.head.append(meta);
  // Keep the bearer only in this mount's memory, never history/storage.
  window.history.replaceState(window.history.state,'',window.location.pathname);
  if(!token.current||!/^[0-9a-f]{64}$/.test(token.current))setError(true);else void refreshDocument();
  return()=>{alive.current=false;++documentGeneration.current;++paymentGeneration.current;documentAbort.current?.abort();documentContext.current=null;meta.remove();};
 },[refreshDocument]);
 useEffect(()=>{
  if(!payment?.url||payment.expiresAt===null)return;let timer:ReturnType<typeof setTimeout>;
  const check=()=>{const remaining=payment.expiresAt!-Date.now();if(remaining<=0){
   setFinancial(current=>current?.request?{...current,request:{...current.request,url:null}}:current);
   setPaymentNotice('This secure payment link is no longer available. Refresh payment status or contact the business.');
  }else timer=setTimeout(check,Math.min(remaining,2147483647));};
  check();return()=>clearTimeout(timer);
 },[payment?.url,payment?.expiresAt]);
 const download=async(print=false)=>{
  if(!html||outdated||pdfBusy||!token.current)return;const popup=print?window.open('about:blank','_blank'):null;if(popup)popup.opener=null;
  setPdfBusy(true);setPdfNotice('');
  try{
   const blob=await readInvoicePdf(endpoint()+'&format=pdf',readOptions.headers);if(!alive.current){popup?.close();return;}
   if(print){if(!popup)throw Error('POPUP_BLOCKED');const url=URL.createObjectURL(blob);popup.location.replace(url);setTimeout(()=>URL.revokeObjectURL(url),60000);}
   else downloadInvoicePdf(blob,'document');
  }catch{popup?.close();if(alive.current)setPdfNotice('PDF could not be opened. Retry, or allow the PDF window to open.');}
  finally{if(alive.current)setPdfBusy(false);}
 };
 return <main className="invoice-document-page">
  <div className="invoice-document-toolbar">
   <button disabled={!html||outdated||pdfBusy} onClick={()=>void download(true)}>Open PDF / print</button>
   <button disabled={!html||outdated||pdfBusy} onClick={()=>void download()}>Download PDF</button>
   {pdfBusy&&<span role="status">Preparing PDF…</span>}
  </div>
  {html&&<section className="invoice-payment-request" aria-label="Invoice payment">
   <button disabled={paymentBusy||outdated} onClick={()=>void refreshPayment()}>{paymentBusy?'Checking payment status…':'Refresh payment status'}</button>
   {outdated&&<button onClick={()=>void refreshDocument()}>Refresh invoice</button>}
   {paymentNotice&&<p role="alert">{paymentNotice}</p>}
   {summary&&<>
    <p role="status">{summary.standing!=='recorded'?'Balance awaiting verification':summary.outstanding_minor===0?'No amount due':'Outstanding balance: '+formatPaymentMinor(summary.outstanding_minor!,summary.currency)}</p>
    {summary.standing!=='recorded'&&<p>The business is checking the balance. No payment link is available.</p>}
    {(summary.refund_payable_minor??0)>0&&<p>Refund still due: {formatPaymentMinor(summary.refund_payable_minor!,summary.currency)}</p>}
    {(summary.credit_minor??0)>0&&<p>Credit applied: {formatPaymentMinor(summary.credit_minor!,summary.currency)}</p>}
    {summary.test_provider_minor>0&&<p>TEST payment evidence: {formatPaymentMinor(summary.test_provider_minor,summary.currency)}. No money moved.</p>}
    {!payment&&summary.standing==='recorded'&&summary.outstanding_minor!>0&&<p>No secure payment request is available. Contact the business for payment instructions.</p>}
   </>}
   {payment&&<>
    <p role="status">{payment.state==='settled'?(financial?.environment==='test'?'Original TEST request confirmed. No money moved.':'Original payment request confirmed. The current balance includes recorded adjustments.'):customerPaymentRequestCopy(payment.state)}</p>
    {payment.state==='customer_action_required'&&!payment.url&&!paymentNotice&&<p>This secure payment link is no longer available. Refresh payment status or contact the business.</p>}
    {payment.url&&<>
     {financial?.environment==='test'&&<p>TEST checkout. No real payment will be collected.</p>}
     <p>Requested payment: {formatPaymentMinor(payment.amountMinor,payment.currency)}</p>
     <a href={payment.url} target="_blank" rel="noopener noreferrer">{financial?.environment==='test'?'Continue to TEST checkout':'Continue to secure payment'}</a>
     <p>Your payment provider handles payment details. Your invoice balance updates after confirmation.</p>
    </>}
   </>}
  </section>}
  {pdfNotice&&<p role="alert">{pdfNotice}</p>}
  {error?<p role="alert">This invoice link is unavailable. Ask the business for a new link. <button onClick={()=>void refreshDocument()}>Retry invoice</button></p>
   :outdated?<p role="status">Document refresh required.</p>
   :html?<iframe title="Invoice document" sandbox="allow-same-origin allow-modals" srcDoc={html}/>
   :<p role="status">Opening invoice…</p>}
 </main>;
}
