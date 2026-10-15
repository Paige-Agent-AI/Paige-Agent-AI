import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {withClientInvoiceRead,type ClientInvoiceDocumentPort} from '@/lib/client-invoice-document';
import {readInvoicePdf,downloadInvoicePdf} from '@/solo/sales/invoicePdf';
import {InvoiceDocumentFrame} from './InvoiceDocumentFrame';
import {InvoicePaymentRequestView} from './InvoicePaymentRequestView';
import {readCustomerPaymentRequest,type CustomerPaymentRequest} from '@/solo/sales/customerPaymentRequest';

const caller=supabase as unknown as ClientInvoiceDocumentPort;
const unavailable='This invoice is unavailable with your current client access. Return to your account or contact your team.';
export default function ClientScopedInvoiceDocument({target}:{target:{tenantId:string;clientId:string;invoiceId:string}}){
  const [html,setHtml]=useState<string|null>(null),[error,setError]=useState(false),[loading,setLoading]=useState(true);
  const [pdfBusy,setPdfBusy]=useState(false),[pdfNotice,setPdfNotice]=useState('');
  const [payment,setPayment]=useState<CustomerPaymentRequest|null>(null),[paymentBusy,setPaymentBusy]=useState(false),[paymentNotice,setPaymentNotice]=useState('');
  const alive=useRef(true),epoch=useRef(0),actor=useRef<string|null>(null);
  const htmlRequest=useRef<AbortController|null>(null),pdfRequest=useRef<AbortController|null>(null);
  const paymentRequest=useRef<AbortController|null>(null);
  const selected=useRef(Object.freeze({...target}));
  const url=useCallback((format?:'pdf'|'payment-request')=>{
    const query=new URLSearchParams({invoice_id:selected.current.invoiceId,tenant_id:selected.current.tenantId,client_id:selected.current.clientId});
    if(format)query.set('format',format);
    return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sales-invoice-document?${query}`;
  },[]);
  const retire=useCallback(()=>{
    epoch.current++;htmlRequest.current?.abort();pdfRequest.current?.abort();paymentRequest.current?.abort();
    if(alive.current){setHtml(null);setError(true);setLoading(false);setPdfBusy(false);setPdfNotice('');setPayment(null);setPaymentBusy(false);setPaymentNotice('');}
  },[]);
  const refreshPayment=useCallback(async()=>{
    paymentRequest.current?.abort();const controller=new AbortController();paymentRequest.current=controller;
    const turn=epoch.current,current=()=>alive.current&&turn===epoch.current&&!controller.signal.aborted;
    setPayment(null);setPaymentBusy(true);setPaymentNotice('');
    const result=await withClientInvoiceRead(caller,selected.current,current,async({headers})=>{
      const response=await fetch(url('payment-request'),{signal:controller.signal,cache:'no-store',referrerPolicy:'no-referrer',headers:{...headers,apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}});
      if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw Error('PAYMENT_STATUS_UNAVAILABLE');
      return response.json();
    });
    if(!current())return;
    setPaymentBusy(false);
    if(result.kind==='ready')setPayment(readCustomerPaymentRequest(result.value));
    else if(result.kind==='refused')retire();
    else setPaymentNotice('Payment status could not be checked. Retry or contact the business.');
  },[retire,url]);
  const load=useCallback(async()=>{
    htmlRequest.current?.abort();const controller=new AbortController();htmlRequest.current=controller;
    const turn=++epoch.current,current=()=>alive.current&&turn===epoch.current&&!controller.signal.aborted;
    paymentRequest.current?.abort();setPayment(null);setPaymentNotice('');setPaymentBusy(false);
    setHtml(null);setError(false);setLoading(true);setPdfNotice('');
    const result=await withClientInvoiceRead(caller,selected.current,current,async({headers})=>{
      const response=await fetch(url(),{signal:controller.signal,cache:'no-store',referrerPolicy:'no-referrer',headers:{...headers,apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}});
      if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))throw Error('INVOICE_UNAVAILABLE');
      return response.text();
    });
    if(!current())return;
    setLoading(false);
    if(result.kind==='ready'){actor.current=result.scope.actorId;setHtml(result.value);void refreshPayment();}else{setHtml(null);setError(true);}
  },[url,refreshPayment]);
  useEffect(()=>{
    alive.current=true;
    const meta=document.createElement('meta');meta.name='referrer';meta.content='no-referrer';document.head.append(meta);
    const {data}=supabase.auth.onAuthStateChange((event,session)=>{
      if(event==='SIGNED_OUT'||(actor.current!==null&&session?.user.id!==actor.current))retire();
    });
    const recheck=()=>{if(document.visibilityState==='visible'&&!pdfRequest.current)void load();};
    window.addEventListener('focus',recheck);window.addEventListener('pageshow',recheck);document.addEventListener('visibilitychange',recheck);
    void load();
    return()=>{alive.current=false;retire();data.subscription.unsubscribe();meta.remove();window.removeEventListener('focus',recheck);window.removeEventListener('pageshow',recheck);document.removeEventListener('visibilitychange',recheck);};
  },[load,retire]);
  const download=async(print:boolean)=>{
    if(!html||loading||pdfBusy||pdfRequest.current)return;
    const popup=print?window.open('about:blank','_blank'):null;if(popup)popup.opener=null;
    const controller=new AbortController();pdfRequest.current=controller;const turn=epoch.current;
    const current=()=>alive.current&&turn===epoch.current&&!controller.signal.aborted;
    setPdfBusy(true);setPdfNotice('');
    try{
      const result=await withClientInvoiceRead(caller,selected.current,current,({headers})=>readInvoicePdf(url('pdf'),{...headers,apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY},controller.signal));
      if(!current()||result.kind!=='ready'){
        popup?.close();
        if(current()){
          if(result.kind==='refused')retire();
          else setPdfNotice('PDF could not be opened. Retry, or allow the PDF window to open.');
        }
        return;
      }
      if(print){if(!popup)throw Error('POPUP_BLOCKED');const objectUrl=URL.createObjectURL(result.value);popup.location.replace(objectUrl);setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);}
      else downloadInvoicePdf(result.value,'document');
    }catch{popup?.close();if(current())setPdfNotice('PDF could not be opened. Retry, or allow the PDF window to open.');}
    finally{if(pdfRequest.current===controller)pdfRequest.current=null;if(alive.current)setPdfBusy(false);}
  };
  return <InvoiceDocumentFrame html={html} error={error?unavailable:null} pdfBusy={pdfBusy} pdfNotice={pdfNotice} download={print=>void download(print)}
    toolbar={<><a href="/app/actions">Your account</a><button type="button" disabled={loading||pdfBusy} onClick={()=>void load()}>Check invoice again</button></>}>
    {html&&<InvoicePaymentRequestView payment={payment} busy={paymentBusy} notice={paymentNotice} refresh={()=>void refreshPayment()}/>}
  </InvoiceDocumentFrame>;
}
