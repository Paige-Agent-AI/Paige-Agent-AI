import {useEffect} from 'react';
import './invoice-document.css';
/** Provider navigation is not payment evidence. This public page performs no mutations,
 * analytics, session reads, or interpretation of provider-supplied query parameters. */
export default function PaymentReturn(){
 useEffect(()=>{window.history.replaceState(window.history.state,'',window.location.pathname);const meta=document.createElement('meta');meta.name='referrer';meta.content='no-referrer';document.head.append(meta);return()=>meta.remove();},[]);
 return <main className="invoice-payment-return"><h1>Check your invoice for the latest balance</h1><p>If you completed payment, the business will confirm it with the payment provider.</p><p>If you cancelled checkout, no payment is confirmed by returning here. You can reopen the payment link from your invoice.</p><p>You may close this page.</p></main>;
}
