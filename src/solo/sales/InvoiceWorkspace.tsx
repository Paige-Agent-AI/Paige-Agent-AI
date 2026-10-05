import React from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {useTheme} from 'next-themes';
import {supabase} from '@/integrations/supabase/client';
import {InvoiceLifecycleActions} from './InvoiceLifecycleActions';
import {invoiceDisplayNumber} from './invoicePaymentCopy';
import type {InvoiceRecord} from './invoiceLifecycleApi';

export function InvoiceWorkspace({tenantId,invoiceId,version,number,status,canManage,onChanged,open:controlledOpen,onOpenChange}:{tenantId:string;invoiceId:string;version:number;number:string;status:InvoiceRecord['status'];canManage:boolean;onChanged():void;open?:boolean;onOpenChange?:(open:boolean)=>void}) {
  const {resolvedTheme}=useTheme();
  const [localOpen,setLocalOpen]=React.useState(false),[html,setHtml]=React.useState(''),[error,setError]=React.useState(false),[retry,setRetry]=React.useState(0),[preview,setPreview]=React.useState(false);
  const open=controlledOpen??localOpen;
  const setOpen=React.useCallback((next:boolean)=>{setLocalOpen(next);onOpenChange?.(next);},[onOpenChange]);
  const invoker=React.useRef<HTMLElement|null>(null);
  const closeEvent=React.useMemo(()=>`invoice-workspace-close:${tenantId}:${invoiceId}`,[tenantId,invoiceId]);
  React.useEffect(()=>{if(!open)return;let current=true;setHtml('');setError(false);
    if(status==='draft')return;
    void (async()=>{try{const {data}=await supabase.auth.getSession();if(!data.session)throw Error();const response=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sales-invoice-document?invoice_id=${encodeURIComponent(invoiceId)}&tenant_id=${encodeURIComponent(tenantId)}`,{headers:{Authorization:`Bearer ${data.session.access_token}`,apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY},cache:'no-store',referrerPolicy:'no-referrer'});if(!response.ok)throw Error();const document=await response.text();if(current)setHtml(document);}catch{if(current)setError(true);}})();return()=>{current=false};
  },[open,tenantId,invoiceId,version,status,retry]);
  const requestClose=()=>window.dispatchEvent(new Event(closeEvent));
  return <><button className="btn" onClick={()=>setOpen(true)}>Open actions & records</button><Dialog open={open} onOpenChange={next=>{if(!next)requestClose();}}><DialogContent overlayClassName="sb-invoice-workspace-overlay" className="paige-solo sb-invoice-workspace" data-theme={resolvedTheme==='dark'?'dark':'light'} onPointerDownOutside={e=>e.preventDefault()} onEscapeKeyDown={e=>{e.preventDefault();requestClose();}} onOpenAutoFocus={()=>{invoker.current=document.activeElement as HTMLElement|null;}} onCloseAutoFocus={e=>{e.preventDefault();invoker.current?.isConnected&&invoker.current.focus();}} aria-describedby={undefined}><DialogHeader><DialogTitle>{status==='draft'?'Draft invoice':`Invoice ${invoiceDisplayNumber(number,true)}`}</DialogTitle></DialogHeader><div className="sb-invoice-workspace-body"><div className="sb-invoice-workspace-grid"><section className={`sb-invoice-preview${preview||status==='draft'?' is-visible':''}`} aria-label="Customer invoice preview">{status==='draft'?<p>Not issued. Review and publish this draft to create its customer invoice document.</p>:html?<iframe sandbox="" srcDoc={html} title="Customer invoice preview"/>:error?<p role="alert">Invoice preview unavailable. <button className="btn" onClick={()=>setRetry(n=>n+1)}>Retry preview</button></p>:<p role="status">Reading invoice preview…</p>}</section><section>{status!=='draft'&&<button className="btn sb-preview-toggle" aria-expanded={preview} onClick={()=>setPreview(v=>!v)}>{preview?'Hide':'Show'} invoice preview</button>}<InvoiceLifecycleActions tenantId={tenantId} invoiceId={invoiceId} version={version} canManage={canManage} onChanged={()=>{setRetry(n=>n+1);onChanged();}} workspaceCloseEvent={closeEvent} onWorkspaceClose={()=>setOpen(false)}/></section></div></div></DialogContent></Dialog></>;
}
