import {useEffect,useState} from 'react';
import {customerPaymentRequestCopy,formatPaymentMinor,type CustomerPaymentRequest} from '@/solo/sales/customerPaymentRequest';

/** Shared read-only presentation. The domain decides whether checkout is usable. */
export function InvoicePaymentRequestView({payment,busy,notice,refresh}:{
  payment:CustomerPaymentRequest|null;busy:boolean;notice:string;refresh:()=>void;
}){
  const [,tick]=useState(0);
  useEffect(()=>{
    if(!payment?.url||payment.expiresAt===null)return;
    let timer:ReturnType<typeof setTimeout>;
    const check=()=>{
      const remaining=payment.expiresAt!-Date.now();
      if(remaining<=0)tick(value=>value+1);
      else timer=setTimeout(check,Math.min(remaining,2147483647));
    };
    check();return()=>clearTimeout(timer);
  },[payment?.url,payment?.expiresAt]);
  const url=payment?.url&&payment.expiresAt!==null&&payment.expiresAt>Date.now()?payment.url:null;
  return <section className="invoice-payment-request" aria-label="Invoice payment">
    <button type="button" disabled={busy} onClick={refresh}>{busy?'Checking payment status…':'Refresh payment status'}</button>
    {notice&&<p role="alert">{notice}</p>}
    {!busy&&!payment&&!notice&&<p>No secure payment request is available. Contact the business for payment instructions.</p>}
    {payment&&<>
      <p role="status">{customerPaymentRequestCopy(payment.state,payment.environment)}</p>
      {payment.environment==='test'&&<p>Test mode · no live payment</p>}
      {payment.environment==='unverified'&&<p>The provider environment could not be confirmed. Ask the business to check this request.</p>}
      <p>Recorded balance: {formatPaymentMinor(payment.remainingMinor,payment.currency)}</p>
      {payment.state==='customer_action_required'&&!url&&!notice&&<p>This secure payment link is no longer available. Refresh payment status or contact the business.</p>}
      {url&&<>
        <p>Requested payment: {formatPaymentMinor(payment.amountMinor,payment.currency)}</p>
        <a href={url} target="_blank" rel="noopener noreferrer">{payment.environment==='test'?'Continue to test checkout':'Continue to secure payment'}</a>
        <p>Your payment provider handles payment details. Your invoice balance updates after confirmation.</p>
      </>}
    </>}
  </section>;
}
