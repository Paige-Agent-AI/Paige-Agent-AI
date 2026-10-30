import React from 'react';
import {createRoot} from 'react-dom/client';
import {ThemeProvider} from 'next-themes';
import {InvoiceLifecycleActions} from '@/solo/sales/InvoiceLifecycleActions';
import {InvoiceWorkspace} from '@/solo/sales/InvoiceWorkspace';
import InvoiceDocument from '@/pages/InvoiceDocument';
import {formatPaymentMinor} from '@/solo/sales/customerPaymentRequest';
import {acceptedPlanEnabled,expireAcceptedFixtureSession} from './accepted-plan';
import {acceptedPlanFixtureIds as ids} from '../accepted-plan-fixture';
import '@/index.css';
import '@/solo/solo-tokens.css';
import '@/solo/solo-campaigns.css';
import '@/solo/sales/sales-billing.css';

const query=new URLSearchParams(location.search),customer=query.get('surface')==='customer';
const theme=query.get('theme')==='dark'?'dark':'light';
const width=Number(query.get('viewport'));
const framed=query.get('frame')==='1';
if(customer){
 const state=query.get('state')||'customer_action_required';
 const amountCase=query.get('money');
 const large=['large-usd','large-kwd','unknown-currency'].includes(amountCase||'');
 const currency=amountCase==='large-kwd'?'kwd':amountCase==='unknown-currency'?'zzz':'usd';
 const requested=large?Number.MAX_SAFE_INTEGER:50000,remaining=large?Number.MAX_SAFE_INTEGER:300000;
 const document=large?`<h1>Invoice INV-1042</h1><p>SYNTHETIC LOCAL DOCUMENT · no customer or provider result.</p><p>Outstanding ${formatPaymentMinor(remaining,currency)}</p>`:'<h1>Invoice INV-1042</h1><p>Jordan Lee</p><p>Total $3,500.00 · Recorded $500.00 · Outstanding $3,000.00</p>';
 window.fetch=async(input)=>new Response(String(input).includes('format=payment-request')?JSON.stringify({remaining_cents:remaining,payment_request:state==='empty'?null:{amount_minor:requested,currency,state:state==='expired_fixture'?'customer_action_required':state,provider_url:'https://checkout.stripe.com/c/pay/test',expires_at:new Date(Date.now()+(state==='expired_fixture'?-1000:3600000)).toISOString()}}):document,{status:200,headers:{'content-type':String(input).includes('format=payment-request')?'application/json':'text/html'}});
}else if(acceptedPlanEnabled){
 // A static document port only; CSP denies all network connections.
 window.fetch=async()=>new Response('<html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px system-ui;padding:24px;color:#201c18;background:#fff"><p>SYNTHETIC LOCAL DOCUMENT</p><h1>Invoice INV-1042</h1><h2>Consulting engagement</h2><p>Accepted principal $3,500.00</p><p>Deposit $500.00 · Ten monthly payments of $300.00</p><p>This preview is not a customer invoice or signed document.</p></body></html>',{status:200,headers:{'content-type':'text/html'}});
}
export function Fixture(){
 const [workspace,setWorkspace]=React.useState(false);
 const [expired,setExpired]=React.useState(false);
 const canManage=query.get('role')!=='readonly';
 return <main className="paige-solo solo-campaigns" data-theme={theme} style={{minHeight:'100dvh',padding:20}}>
  <p>LOCAL RENDERED FIXTURE · no backend, authenticated acceptance, payment or signature evidence.</p>
  <h1>Invoice INV-1042</h1>
  <details><summary>Synthetic request evidence</summary><pre id="e04-last-request" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>No request made.</pre></details>
  {acceptedPlanEnabled&&<p><button className="btn" disabled={expired} onClick={()=>{expireAcceptedFixtureSession();setExpired(true)}}>Expire simulated account session</button></p>}
  {query.get('surface')==='workspace'?
   <InvoiceWorkspace tenantId={ids.tenant} invoiceId={ids.invoice} version={2} number="INV-1042" status="issued" canManage={canManage} open={workspace} onOpenChange={setWorkspace} onChanged={()=>{}}/>:
   <InvoiceLifecycleActions tenantId={ids.tenant} invoiceId={ids.invoice} version={2} canManage={canManage} onChanged={()=>{}}/>}
 </main>;
}
const root=createRoot(document.getElementById('root')!);
if(!framed&&[320,390,768,1024,1536].includes(width)){
 const url=new URL(location.href);url.searchParams.set('frame','1');url.searchParams.delete('viewport');
 root.render(<main style={{margin:0,minHeight:'100vh',background:theme==='dark'?'#111':'#eee'}}><p style={{margin:0,padding:8}}>Local {width}px CSS-viewport frame · actual invoice components · no backend.</p><iframe title="Local invoice responsive frame" src={url.href} style={{display:'block',width,height:'calc(100dvh - 40px)',maxWidth:'100%',border:0,margin:'0 auto'}}/></main>);
}else root.render(<ThemeProvider attribute="class" defaultTheme={theme} enableSystem={false} storageKey={"e04-local-invoice-theme-"+theme}>{customer?<InvoiceDocument/>:<Fixture/>}</ThemeProvider>);
