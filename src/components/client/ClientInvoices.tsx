import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useOutletContext} from 'react-router-dom';
import type {Session} from '@supabase/supabase-js';
import {supabase} from '@/integrations/supabase/client';
import type {ClientDeliveryPortalPort} from '@/lib/client-delivery-portal';
import {readClientCommercialStatus,type ClientCommercialCursor,type ClientCommercialRead} from '@/lib/client-commercial-status';
import {formatPaymentMinor} from '@/solo/sales/customerPaymentRequest';
import {useClientDeliveryPortal} from './client-delivery-portal-context';
import './client-commercial.css';

type View={actorId:string|null;loading:boolean;result:ClientCommercialRead|null;path:(ClientCommercialCursor|null)[]};
const caller=supabase as unknown as ClientDeliveryPortalPort;
const money=(minor:string,currency:string)=>formatPaymentMinor(minor,currency);
const due=(value:string)=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
const reference=(value:string|null)=>value?.trim()&&!/^DRAFT-/i.test(value)?`Invoice ${value}`:'Previously issued invoice';

/** Canonical read projection only; no invoice, payment, approval or identity store. */
export function ClientInvoices(){
  const portal=useClientDeliveryPortal();
  const outlet=useOutletContext<{session?:Session|null}>();
  const actorId=outlet?.session?.user.id??null,preview=!portal||portal.preview;
  const sequence=useRef(0),mounted=useRef(true),scope=useRef({actorId,preview});
  scope.current={actorId,preview};
  const retireReads=useCallback(()=>{sequence.current++;},[]);
  const [view,setView]=useState<View>({actorId:null,loading:false,result:null,path:[null]});
  const read=useCallback(async(path:(ClientCommercialCursor|null)[])=>{
    if(!actorId||preview||!mounted.current)return;
    const turn=++sequence.current;
    const current=()=>mounted.current&&sequence.current===turn&&scope.current.actorId===actorId&&!scope.current.preview;
    setView({actorId,loading:true,result:null,path});
    const after=path[path.length-1];
    const result=await readClientCommercialStatus(caller,actorId,current,after?{after}:{});
    if(current())setView({actorId,loading:false,result,path});
  },[actorId,preview]);
  useLayoutEffect(()=>{
    retireReads();setView({actorId,loading:Boolean(actorId&&!preview),result:null,path:[null]});
  },[actorId,preview,retireReads]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;retireReads();};},[retireReads]);
  useEffect(()=>{
    if(actorId&&!preview)void read([null]);
    const {data}=supabase.auth.onAuthStateChange((_event,session)=>{
      if(mounted.current&&(session?.user.id??null)!==actorId){retireReads();setView({actorId,loading:false,result:{kind:'refused'},path:[null]});}
    });
    return()=>{retireReads();data.subscription.unsubscribe();};
  },[actorId,preview,read,retireReads]);
  useEffect(()=>{
    const refresh=()=>{if(document.visibilityState==='visible'&&actorId&&!preview)void read([null]);};
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[actorId,preview,read]);
  if(!portal)return null;
  const result=view.actorId===actorId?view.result:null;
  const ready=result?.kind==='ready'?result:null;
  const loading=Boolean(actorId&&!preview&&(view.actorId!==actorId||view.loading));
  const hasTest=ready?.status.balances.some(balance=>balance.testProviderMinor!=='0')??false;
  return <section className="client-commercial-panel" aria-labelledby="client-commercial-title">
    <header><h2 id="client-commercial-title">Your invoices</h2><button type="button" disabled={!actorId||preview||loading} onClick={()=>void read([null])}>Check balances again</button></header>
    {preview?<p>Open your own client session to view your invoices.</p>:!actorId?<p>Sign in to view your invoices.</p>
      :loading?<p role="status">Checking your invoices…</p>
      :ready?<>
        {ready.status.invoiceCount===0?<p>No invoices are available for this client account.</p>:<>
          <dl className="client-commercial-balances">{ready.status.balances.map(balance=><div key={balance.currency}>
            <dt>{hasTest?'Recorded balance':balance.remainingMinor.startsWith('-')?'Credit balance':'Outstanding'}</dt>
            <dd>{money(balance.remainingMinor.startsWith('-')?balance.remainingMinor.slice(1):balance.remainingMinor,balance.currency)}</dd>
          </div>)}</dl>
          {hasTest&&<p role="status" className="client-commercial-caution">Test activity is included in this record. Ask your team to confirm the amount due.</p>}
          <p className="client-commercial-next">Your next payment schedule is unavailable here. Ask your team to confirm the dates.</p>
          {!ready.status.invoices.length?<p>No invoices are on this page.</p>:<ul className="client-commercial-invoices">{ready.status.invoices.map(invoice=>{
            const title=reference(invoice.invoiceNumber);
            const destination='/invoice?'+new URLSearchParams({invoice_id:invoice.id,tenant_id:ready.scope.tenantId,client_id:ready.scope.clientId}).toString();
            return <li key={invoice.id}><div><h3>{title}</h3>
              <p>{invoice.status==='void'?'Voided':invoice.status==='recorded'?'Business-recorded invoice':invoice.dueDate?`Due ${due(invoice.dueDate)}`:'Due date not recorded'}</p>
              {invoice.status!=='void'&&<p className="client-commercial-amount">{money(invoice.remainingMinor.startsWith('-')?invoice.remainingMinor.slice(1):invoice.remainingMinor,invoice.currency)} {invoice.testProviderMinor!=='0'?'recorded balance':invoice.remainingMinor.startsWith('-')?'credit balance':'outstanding'}</p>}
            </div>{invoice.documentAvailable?<a href={destination} target="_blank" rel="noopener noreferrer" aria-label={`View ${title.toLowerCase()} (opens a new tab)`}>View invoice</a>:<span className="client-commercial-next">Document unavailable</span>}</li>;
          })}</ul>}
          {(view.path.length>1||ready.status.hasMore)&&<nav className="client-commercial-paging" aria-label="Invoice pages">
            <button type="button" disabled={view.path.length<2} onClick={()=>void read(view.path.slice(0,-1))}>Previous invoices</button>
            <button type="button" disabled={!ready.status.hasMore||!ready.status.nextCursor} onClick={()=>{if(ready.status.nextCursor)void read([...view.path,ready.status.nextCursor]);}}>More invoices</button>
          </nav>}
          <p className="client-commercial-checked">Checked {new Date(ready.status.readAt).toLocaleString()}</p>
        </>}
      </>:<div role="status"><p>{result?.kind==='unlinked'?'Your client link could not be found. Ask your team to check access.'
        :result?.kind==='ambiguous'?'Your client access could not be resolved safely. Ask your team to check access.'
          :result?.kind==='refused'?'These invoices are no longer available with your current access.'
            :'Your invoices could not be read. Check your connection and try again.'}</p>
        <button type="button" onClick={()=>void read([null])}>Try again</button>
      </div>}
  </section>;
}
