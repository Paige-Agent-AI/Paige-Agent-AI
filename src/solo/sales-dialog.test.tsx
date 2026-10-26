import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {useSalesDraftExit} from './sales-dialog';
import {hasUnsavedWork, useBeforeUnloadGuard} from '@/hooks/useBeforeUnloadGuard';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let root:ReturnType<typeof createRoot>;let host:HTMLDivElement;
function Harness(){const [draft,setDraft]=React.useState('');const guard=useSalesDraftExit(draft,false,()=>{});return <div><input value={draft} onChange={e=>setDraft(e.target.value)}/>{guard.confirmation}</div>;}
function open(){history.replaceState(null,'','/solo/alpha/growth/sales');host=document.createElement('div');document.body.append(host);root=createRoot(host);act(()=>root.render(<Harness/>));const input=host.querySelector('input')!;act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'dirty');input.dispatchEvent(new Event('input',{bubbles:true}));});}
afterEach(()=>{act(()=>root?.unmount());host?.remove();history.replaceState(null,'','/');vi.restoreAllMocks();vi.unstubAllGlobals();});
it.each(['listbox','menu'])('lets the native %s dismiss itself without leaving or discarding the Sales draft',role=>{
  open();const popup=document.createElement('div'),choice=document.createElement('button');popup.setAttribute('role',role);popup.append(choice);host.append(popup);choice.focus();
  act(()=>choice.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
  expect(host.querySelector('[role=alertdialog]')).toBeNull();expect(document.activeElement).toBe(choice);
  const leave=new Event('beforeunload',{cancelable:true});window.dispatchEvent(leave);expect(leave.defaultPrevented).toBe(true);
  popup.remove();act(()=>host.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
  expect(host.querySelectorAll('[role=alertdialog]')).toHaveLength(1);
});
it('honors an Escape already handled by the original child editor without disabling the leave guard',()=>{
  open();const input=host.querySelector('input')!;input.addEventListener('keydown',event=>event.preventDefault(),{once:true});
  act(()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
  expect(host.querySelector('[role=alertdialog]')).toBeNull();const leave=new Event('beforeunload',{cancelable:true});window.dispatchEvent(leave);expect(leave.defaultPrevented).toBe(true);
  act(()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));expect(host.querySelectorAll('[role=alertdialog]')).toHaveLength(1);
});
it('does not leave the draft when Escape belongs to input composition',()=>{
  open();act(()=>host.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true,cancelable:true})));
  expect(host.querySelector('[role=alertdialog]')).toBeNull();const leave=new Event('beforeunload',{cancelable:true});window.dispatchEvent(leave);expect(leave.defaultPrevented).toBe(true);
});
it('retains only opaque recovery metadata on the same agreement without bypassing unsaved-work protection',()=>{
  const navigation=new EventTarget();vi.stubGlobal('navigation',navigation);
  const id='aaaaaaaa-0000-4000-8000-000000000001',request='bbbbbbbb-0000-4000-8000-000000000001',tenant='cccccccc-0000-4000-8000-000000000001';
  history.replaceState(null,'',`/solo/alpha/sales/agreements?agreement=${id}&theme=light`);
  let retain!:(url:string,replace:()=>void)=>boolean;
  function Checkpoint(){const guard=useSalesDraftExit('private unsaved work',false,()=>{}, {uncertain:true});retain=guard.retainRequestLocation;return <>{guard.confirmation}</>;}
  host=document.createElement('div');document.body.append(host);root=createRoot(host);act(()=>root.render(<Checkpoint/>));
  const target=`/solo/alpha/sales/agreements?agreement=${id}&theme=light&agreement_signer_request=${request}&agreement_business=${tenant}`;
  let retained=false;act(()=>{retained=retain(target,()=>{const event=new Event('navigate',{cancelable:true});Object.assign(event,{destination:{url:new URL(target,location.href).href}});navigation.dispatchEvent(event);expect(event.defaultPrevented).toBe(false);history.replaceState(null,'',target);});});expect(retained).toBe(true);expect(location.search).toContain(request);
  const before=new Event('beforeunload',{cancelable:true});window.dispatchEvent(before);expect(before.defaultPrevented).toBe(true);expect(hasUnsavedWork()).toBe(true);
  const clear=`/solo/alpha/sales/agreements?agreement=${id}&theme=light`;act(()=>{retained=retain(clear,()=>history.replaceState(null,'',clear));});expect(retained).toBe(true);expect(location.search).not.toContain(request);
  expect(retain(target,()=>{throw new DOMException('Navigation stopped','AbortError');})).toBe(false);
  const exit=new Event('navigate',{cancelable:true});Object.assign(exit,{destination:{url:new URL('/solo/alpha/sales/offers',location.href).href}});act(()=>navigation.dispatchEvent(exit));expect(exit.defaultPrevented).toBe(true);expect(host.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
});
it.each(['https://outside.example.test/solo/alpha/sales/agreements?agreement=aaaaaaaa-0000-4000-8000-000000000001','/solo/beta/sales/agreements?agreement=aaaaaaaa-0000-4000-8000-000000000001','?agreement=aaaaaaaa-0000-4000-8000-000000000002','?agreement=aaaaaaaa-0000-4000-8000-000000000001&private=words','?agreement=aaaaaaaa-0000-4000-8000-000000000001&agreement_signer_request=private-name&agreement_business=cccccccc-0000-4000-8000-000000000001','?agreement=aaaaaaaa-0000-4000-8000-000000000001&agreement_signer_request=bbbbbbbb-0000-4000-8000-000000000001'])('refuses an exit or private/invalid payload as a recovery checkpoint: %s',target=>{
  history.replaceState(null,'','/solo/alpha/sales/agreements?agreement=aaaaaaaa-0000-4000-8000-000000000001');let retain!:(url:string,replace:()=>void)=>boolean;
  function Checkpoint(){const guard=useSalesDraftExit('',false,()=>{});retain=guard.retainRequestLocation;return <>{guard.confirmation}</>;}
  host=document.createElement('div');document.body.append(host);root=createRoot(host);act(()=>root.render(<Checkpoint/>));const replace=vi.fn();expect(retain(target,replace)).toBe(false);expect(replace).not.toHaveBeenCalled();
});
it('keeps a different editor guard authoritative during an opaque recovery checkpoint',()=>{
  const navigation=new EventTarget();vi.stubGlobal('navigation',navigation);history.replaceState(null,'','/solo/alpha/sales/agreements?agreement=aaaaaaaa-0000-4000-8000-000000000001');
  let retain!:(url:string,replace:()=>void)=>boolean;
  function OtherEditor(){const guard=useSalesDraftExit('other work',false,()=>{}, {uncertain:true});return <>{guard.confirmation}</>;}
  function Checkpoint(){const guard=useSalesDraftExit('',false,()=>{});retain=guard.retainRequestLocation;return <>{guard.confirmation}<OtherEditor/></>;}
  host=document.createElement('div');document.body.append(host);root=createRoot(host);act(()=>root.render(<Checkpoint/>));
  const target='?agreement=aaaaaaaa-0000-4000-8000-000000000001&agreement_signer_request=bbbbbbbb-0000-4000-8000-000000000001&agreement_business=cccccccc-0000-4000-8000-000000000001';let result=true;
  act(()=>{result=retain(target,()=>{const event=new Event('navigate',{cancelable:true});Object.assign(event,{destination:{url:new URL(target,location.href).href}});navigation.dispatchEvent(event);if(!event.defaultPrevented)history.replaceState(null,'',target);});});
  expect(result).toBe(false);expect(location.search).not.toContain('agreement_signer_request');expect(host.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);const leave=new Event('beforeunload',{cancelable:true});window.dispatchEvent(leave);expect(leave.defaultPrevented).toBe(true);
});
it('retains only the explicit document request kind and keeps unsaved fields guarded',()=>{
  const agreement='aaaaaaaa-0000-4000-8000-000000000001',request='bbbbbbbb-0000-4000-8000-000000000001',tenant='cccccccc-0000-4000-8000-000000000001';
  history.replaceState(null,'',`/solo/alpha/sales/agreements?agreement=${agreement}`);
  let retain!:ReturnType<typeof useSalesDraftExit>['retainRequestLocation'];
  function Checkpoint(){const guard=useSalesDraftExit('private field proposal',false,()=>{}, {uncertain:true});retain=guard.retainRequestLocation;return <>{guard.confirmation}</>;}
  host=document.createElement('div');document.body.append(host);root=createRoot(host);act(()=>root.render(<Checkpoint/>));
  const target=`?agreement=${agreement}&agreement_document_request=${request}&agreement_business=${tenant}`;
  const replace=vi.fn(()=>history.replaceState(null,'',target));expect(retain(target,replace)).toBe(false);expect(replace).not.toHaveBeenCalled();
  act(()=>expect(retain(target,replace,'document')).toBe(true));
  const before=new Event('beforeunload',{cancelable:true});window.dispatchEvent(before);expect(before.defaultPrevented).toBe(true);expect(hasUnsavedWork()).toBe(true);
  for(const bad of [target+`&agreement_signer_request=${request}`,target+`&agreement=${agreement}`,target+'&fields=private',target+`&agreement_document_request=${request}`])expect(retain(bad,vi.fn(),'document')).toBe(false);
});
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

it('retains only an opaque signature reference alongside the original document and keeps the one leave guard',()=>{
  const agreement='aaaaaaaa-0000-4000-8000-000000000001',preparationId='bbbbbbbb-0000-4000-8000-000000000001',business='cccccccc-0000-4000-8000-000000000001',operation='dddddddd-0000-4000-8000-000000000001';
  const start=`/solo/alpha/sales/agreements?agreement=${agreement}&agreement_document_request=${preparationId}&agreement_business=${business}`;
  history.replaceState(null,'',start);let retain!:ReturnType<typeof useSalesDraftExit>['retainRequestLocation'];
  function Checkpoint(){const guard=useSalesDraftExit('private invitations',false,()=>{}, {uncertain:true});retain=guard.retainRequestLocation;return <>{guard.confirmation}</>;}
  host=document.createElement('div');document.body.append(host);root=createRoot(host);act(()=>root.render(<Checkpoint/>));
  const target=start+`&agreement_signature_request=${operation}&agreement_signature_digest=${'a'.repeat(64)}`;
  const replace=vi.fn(()=>history.replaceState(null,'',target));act(()=>expect(retain(target,replace,'signature')).toBe(true));
  expect(location.search).toContain(preparationId);expect(hasUnsavedWork()).toBe(true);
  for(const bad of [target+'&message=private',target+`&agreement_signature_request=${operation}`,target.replace('a'.repeat(64),'invalid'),target.replace(business,operation)]){
    const change=vi.fn();expect(retain(bad,change,'signature')).toBe(false);expect(change).not.toHaveBeenCalled();
  }
  const clear=new URL(location.href);clear.searchParams.delete('agreement_document_request');
  act(()=>expect(retain(clear.href,()=>history.replaceState(null,'',clear.href),'document')).toBe(true));
  expect(location.search).toContain(operation);expect(location.search).toContain(business);
});
it('fallback protects same-account Back with a visible choice',()=>{open();act(()=>{history.replaceState(null,'','/solo/alpha/growth/catalog');window.dispatchEvent(new PopStateEvent('popstate',{state:null}));});expect(location.pathname).toBe('/solo/alpha/growth/sales');expect(host.querySelector('[role="alertdialog"]')).not.toBeNull();expect(document.activeElement?.textContent).toBe('Continue editing');});
it('the original Sales navigation request is intercepted BEFORE route and keyboard focus can advance',()=>{
  open();const proceed=vi.fn(),event=new CustomEvent('paige:sales-before-navigation',{cancelable:true,detail:{proceed}});
  act(()=>{if(window.dispatchEvent(event))proceed();});expect(event.defaultPrevented).toBe(true);expect(proceed).not.toHaveBeenCalled();expect(host.querySelectorAll('[role=alertdialog]')).toHaveLength(1);
  act(()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Continue editing')!.click());expect(proceed).not.toHaveBeenCalled();
  const second=new CustomEvent('paige:sales-before-navigation',{cancelable:true,detail:{proceed}});act(()=>{if(window.dispatchEvent(second))proceed();});
  act(()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Discard changes')!.click());expect(proceed).toHaveBeenCalledOnce();
});
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
