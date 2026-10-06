import React from 'react';
import {supabase} from '@/integrations/supabase/client';
import {parseSalesInvoiceCommand,UUID,type SalesInvoiceCommand} from '../../../supabase/functions/_shared/sales-invoice-command/contract';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {useTheme} from 'next-themes';
import type {InvoiceAppearance} from './invoicePreferences';
import {invoiceDisplayNumber} from './invoicePaymentCopy';
type Result=Record<string,unknown>;
type ReviewProps={tenantId:string;command:SalesInvoiceCommand;operationId?:string;onComplete(result:Result):void;onClose():void};
/** One immutable operation and command, proposed then approved through the canonical server card. */
export function InvoiceCommandReview(props:ReviewProps){
  const [actorId,setActorId]=React.useState<string|null>(null),[resolved,setResolved]=React.useState(false);
  React.useEffect(()=>{let alive=true,epoch=0;const opened=epoch;
    void supabase.auth.getSession().then(({data})=>{if(alive&&epoch===opened){setActorId(data.session?.user.id??null);setResolved(true);}}).catch(()=>{if(alive){setActorId(null);setResolved(true);}});
    const {data}=supabase.auth.onAuthStateChange((_event,session)=>{epoch++;if(alive){setActorId(session?.user.id??null);setResolved(true);}});
    return()=>{alive=false;data.subscription.unsubscribe();};
  },[]);
  if(!resolved)return <p role="status">Checking your account before invoice review…</p>;
  if(!actorId)return <p role="alert">Sign in to review this invoice action.</p>;
  return <ActorInvoiceCommandReview key={`${actorId}:${props.tenantId}`} {...props} actorId={actorId}/>;
}
function ActorInvoiceCommandReview({tenantId,command,operationId,onComplete,onClose,actorId}:ReviewProps&{actorId:string}){
  const {resolvedTheme}=useTheme();const primary=React.useRef<HTMLButtonElement>(null);
  const commandScope=command.action==='invoice.settings_update'?'settings':command.invoice_id;
  const storageKey=`paige:invoice-operation:${actorId}:${tenantId}:${commandScope}`;
  const captured=React.useRef({actorId,tenantId,command:structuredClone(command),operationId:operationId&&UUID.test(operationId)?operationId:crypto.randomUUID()});
  const initialized=React.useRef(false);
  const restored=React.useRef(!!operationId);
  if(!initialized.current){initialized.current=true;try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');const savedScope=saved?.command?.action==='invoice.settings_update'?'settings':saved?.command?.invoice_id;if(saved?.actorId===actorId&&saved?.tenantId===tenantId&&savedScope===commandScope&&(!operationId||saved.operationId===operationId)&&UUID.test(saved.operationId)){captured.current={actorId,tenantId,command:parseSalesInvoiceCommand(saved.command),operationId:saved.operationId};restored.current=true;}}catch{/* invalid stored recovery is not authority */}}
  const latestTenant=React.useRef(tenantId);latestTenant.current=tenantId;
  const unresolved=React.useRef(restored.current);
  const [busy,setBusy]=React.useState(false),[proposal,setProposal]=React.useState<Result|null>(null),[unknown,setUnknown]=React.useState(restored.current),[notice,setNotice]=React.useState('');
  const [template,setTemplate]=React.useState<string>(captured.current.command.action==='invoice.publish'?String(captured.current.command.template??''):''),[attempted,setAttempted]=React.useState(restored.current);
  const alive=React.useRef(true);React.useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
  const settings=captured.current.command.action==='invoice.settings_update'?captured.current.command.settings as InvoiceAppearance:null;
  const paymentAction=captured.current.command.action==='invoice.payment_request';
  const paymentPreview=proposal?.preview as Result|undefined;
  const exactPaymentPreview=!paymentAction||!!(paymentPreview&&typeof paymentPreview.client_name==='string'&&paymentPreview.client_name.trim()&&paymentPreview.client_id&&paymentPreview.invoice_id===captured.current.command.invoice_id&&Number.isSafeInteger(paymentPreview.amount_minor)&&Number(paymentPreview.amount_minor)>0&&typeof paymentPreview.currency==='string'&&['stripe','paypal'].includes(String(paymentPreview.provider))&&typeof paymentPreview.merchant_account_id==='string'&&paymentPreview.merchant_account_id&&['test','live'].includes(String(paymentPreview.environment)));
  const closeReview=()=>{if(busy)return;if(!unknown)forget();onClose();};
  const forget=()=>{try{sessionStorage.removeItem(storageKey)}catch{/* unavailable storage */}};
  const money=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)?new Intl.NumberFormat(undefined,{style:'currency',currency:typeof (proposal?.preview as Result)?.currency==='string'?String((proposal?.preview as Result).currency).toUpperCase():'USD'}).format(v/100):'Unavailable';
  React.useEffect(()=>{if(!busy)primary.current?.focus();},[proposal,busy]);
  React.useEffect(()=>{if(!busy&&!unknown)return;const prevent=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',prevent);return()=>window.removeEventListener('beforeunload',prevent);},[busy,unknown]);
  const execute=async(approve:boolean)=>{
    if(busy||captured.current.tenantId!==latestTenant.current)return;setBusy(true);setNotice('');setAttempted(true);
    try{
      const original=captured.current;
      try{sessionStorage.setItem(storageKey,JSON.stringify(original));}catch{/* in-memory same operation remains */}
      let {data,error}=await supabase.functions.invoke('sales-invoice-command',{body:{expected_tenant_id:original.tenantId,operation_id:original.operationId,command:original.command,...(approve&&proposal?{approved_fingerprint:proposal.fingerprint}:{})}});
      if(error&&'context' in error&&error.context instanceof Response){try{data=await error.context.json();error=null;}catch{/* unresolved response */}}
      if(!alive.current||latestTenant.current!==original.tenantId)return;
      if(data&&typeof data==='object'&&data.outcome==='approval_required'){setProposal(data);setUnknown(false);unresolved.current=false;}
      else if(data?.ok===true){forget();onComplete(data);}
      else{const terminalFailure=data?.outcome==='failed'&&typeof data?.message_id==='string';const uncertain=!terminalFailure&&(unresolved.current||!!error||['outcome_unknown','unknown','dispatching','prepared'].includes(data?.outcome));unresolved.current=uncertain;setUnknown(uncertain);if(!uncertain)forget();setNotice(uncertain?'This operation requires recovery or review. Keep its original identity; do not start another delivery.':data?.message||'The action was refused. Reload the invoice before trying again.');}
    }catch{if(alive.current&&latestTenant.current===captured.current.tenantId){unresolved.current=true;setUnknown(true);setNotice('The result is unknown. Recover this same operation.');}}
    finally{if(alive.current)setBusy(false);}
  };
  return <Dialog open onOpenChange={open=>{if(!open&&!busy&&(!unknown||paymentAction))closeReview();}}><DialogContent className="paige-solo sb-command-dialog" data-theme={resolvedTheme==='dark'?'dark':'light'} onEscapeKeyDown={e=>{if(busy||(unknown&&!paymentAction))e.preventDefault();}} onPointerDownOutside={e=>e.preventDefault()}><DialogHeader><DialogTitle>{commandScope==='settings'?'Review invoice defaults':'Review invoice action'}</DialogTitle></DialogHeader><div className="sb-paper">
    {captured.current.command.action==='invoice.publish'&&<label>Invoice template<select value={template} disabled={attempted||busy} onChange={e=>{const selected=e.target.value;setTemplate(selected);const c=captured.current.command;if(c.action==='invoice.publish'){if(selected)c.template=selected as 'classic'|'modern'|'service';else delete c.template;}}}><option value="">Business default</option><option value="classic">Classic</option><option value="modern">Modern</option><option value="service">Service detail</option></select></label>}
    {restored.current&&<p role="status">Recovering the saved {captured.current.command.action.replace('invoice.','').replace(/_/g,' ')} operation for this invoice. The newly requested action has not started.</p>}
    {proposal?.preview&&typeof proposal.preview==='object'&&commandScope!=='settings'&&<dl><dt>Invoice number</dt><dd>{invoiceDisplayNumber((proposal.preview as Result).invoice_number,captured.current.command.action!=="invoice.publish")}</dd><dt>Current outstanding</dt><dd>{money((proposal.preview as Result).remaining_cents)}</dd>{paymentAction&&<><dt>Customer</dt><dd>{String(paymentPreview?.client_name??'Unavailable')}</dd><dt>Amount requested</dt><dd>{money(paymentPreview?.amount_minor)}</dd><dt>Payment provider</dt><dd>{String(paymentPreview?.provider??'Unavailable')}</dd><dt>Business merchant account</dt><dd>{String(paymentPreview?.merchant_account_id??'Unavailable')}</dd><dt>Environment</dt><dd>{String(paymentPreview?.environment??'Unavailable')}</dd></>}{captured.current.command.action==='invoice.record_manual_payment'&&<><dt>Received amount</dt><dd>{money(captured.current.command.amount_cents)}</dd><dt>Method</dt><dd>{String(captured.current.command.method).replace(/_/g,' ')}</dd><dt>Date received</dt><dd>{new Date(String(captured.current.command.received_at)).toLocaleDateString(undefined,{timeZone:'UTC'})}</dd></>}</dl>}
    {captured.current.command.action==='invoice.settings_update'&&<dl><dt>Template</dt><dd>{settings.template}</dd><dt>Next number example</dt><dd>{settings.prefix}{String(settings.next_number).padStart(settings.padding,'0')}</dd><dt>Applies to</dt><dd>Future invoices. Existing issued documents remain unchanged.</dd></dl>}
    {captured.current.command.action==='invoice.email_send'&&<p>Includes a PDF attachment with the issued invoice and current business-recorded payment history, plus the customer invoice link.</p>}
    {proposal?<><p>{typeof proposal.summary==='string'?proposal.summary:'Review the server-verified invoice consequence before approving.'}</p><button ref={primary} className="btn btn-p" disabled={busy||!exactPaymentPreview} onClick={()=>execute(!unknown)}>{busy?'Checking…':unknown?'Recover approved operation':'Approve action'}</button></>:<><p>Check the saved invoice and its current version before preparing this action.</p><button ref={primary} className="btn btn-p" disabled={busy} onClick={()=>execute(false)}>{busy?'Checking…':unknown?'Recover original operation':'Prepare review'}</button></>}
    {proposal&&paymentAction&&!exactPaymentPreview&&<p role="alert">The exact customer, amount and business payment account could not be reviewed. Reload the invoice before approving.</p>}{notice&&<p role="alert">{notice}</p>}<button className="btn" disabled={busy||(unknown&&!paymentAction)} onClick={closeReview}>{unknown&&paymentAction?'Close review':'Cancel'}</button>
  </div></DialogContent></Dialog>;
}
