import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {useSalesDraftExit} from './sales-dialog';
import {hasUnsavedWork, useBeforeUnloadGuard} from '@/hooks/useBeforeUnloadGuard';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let root:ReturnType<typeof createRoot>;let host:HTMLDivElement;
function Harness(){const [draft,setDraft]=React.useState('');const guard=useSalesDraftExit(draft,false,()=>{});return <div><input value={draft} onChange={e=>setDraft(e.target.value)}/>{guard.confirmation}</div>;}
function open(){history.replaceState(null,'','/solo/alpha/growth/sales');host=document.createElement('div');document.body.append(host);root=createRoot(host);act(()=>root.render(<Harness/>));const input=host.querySelector('input')!;act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'dirty');input.dispatchEvent(new Event('input',{bubbles:true}));});}
afterEach(()=>{act(()=>root?.unmount());host?.remove();history.replaceState(null,'','/');vi.restoreAllMocks();});
it('adopts only an explicit reviewed editor baseline and protects later edits again',()=>{
  let adopt!:(value:unknown)=>void,setValue!:(value:string)=>void;
  function BaselineHarness(){const [value,set]=React.useState('');setValue=set;const guard=useSalesDraftExit(value,false,()=>{});adopt=guard.adoptBaseline;return <>{guard.confirmation}</>;}
  host=document.createElement('div');document.body.append(host);root=createRoot(host);act(()=>root.render(<BaselineHarness/>));
  act(()=>{adopt('Reviewed original');setValue('Reviewed original');});
  let leave=new Event('beforeunload',{cancelable:true});window.dispatchEvent(leave);expect(leave.defaultPrevented).toBe(false);
  act(()=>setValue('Proposed change'));leave=new Event('beforeunload',{cancelable:true});window.dispatchEvent(leave);expect(leave.defaultPrevented).toBe(true);
  act(()=>{adopt('');setValue('');});leave=new Event('beforeunload',{cancelable:true});window.dispatchEvent(leave);expect(leave.defaultPrevented).toBe(false);
  act(()=>setValue('Later proposal'));leave=new Event('beforeunload',{cancelable:true});window.dispatchEvent(leave);expect(leave.defaultPrevented).toBe(true);
});
it('fallback protects same-account Back with a visible choice',()=>{open();act(()=>{history.replaceState(null,'','/solo/alpha/growth/catalog');window.dispatchEvent(new PopStateEvent('popstate',{state:null}));});expect(location.pathname).toBe('/solo/alpha/growth/sales');expect(host.querySelector('[role="alertdialog"]')).not.toBeNull();expect(document.activeElement?.textContent).toBe('Continue editing');});
it('fallback permits a different-account Back without retaining its draft',()=>{open();const listener=vi.fn();window.addEventListener('popstate',listener);act(()=>{history.replaceState(null,'','/solo/beta/growth/sales');window.dispatchEvent(new PopStateEvent('popstate',{state:null}));});expect(host.querySelector('[role="alertdialog"]')).toBeNull();expect(listener).toHaveBeenCalledTimes(1);window.removeEventListener('popstate',listener);});

it('a confirmed receipt transition bypasses only its own native leave warning',()=>{
  let finish!:()=>void;
  function ReceiptHarness(){const guard=useSalesDraftExit('draft',false,()=>{}, {uncertain:true});finish=()=>guard.exitAfterSave(()=>{});return <>{guard.confirmation}</>;}
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  act(()=>root.render(<ReceiptHarness/>));
  const before=new Event('beforeunload',{cancelable:true});window.dispatchEvent(before);expect(before.defaultPrevented).toBe(true);
  act(()=>finish());
  const after=new Event('beforeunload',{cancelable:true});window.dispatchEvent(after);expect(after.defaultPrevented).toBe(false);
});

it('a different editor still blocks after the Sales receipt transition',()=>{
  let finish!:()=>void;
  function OtherWork(){useBeforeUnloadGuard(true);return null;}
  function ReceiptHarness(){const guard=useSalesDraftExit('draft',false,()=>{}, {uncertain:true});finish=()=>guard.exitAfterSave(()=>{});return <OtherWork/>;}
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  act(()=>root.render(<ReceiptHarness/>));act(()=>finish());
  const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);expect(hasUnsavedWork()).toBe(true);
});
