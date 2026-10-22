import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { read, wording } = vi.hoisted(() => ({ read: vi.fn(), wording: vi.fn() }));
vi.mock('./agreementRevisionApi', () => ({ readAgreementRevisions: read, readAgreementRetainedWording: wording }));
import { AgreementWordingHistory } from './AgreementWordingHistory';
// Existing native React DOM test idiom; no added test runtime/dependency.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root | null;
function render(element: React.ReactNode) {
  host=document.createElement('div');document.body.append(host);root=createRoot(host);act(()=>root!.render(element));
  return {unmount:()=>{act(()=>root!.unmount());root=null;}};
}
function cleanup(){if(root)act(()=>root!.unmount());root=null;host?.remove();}
const match=(actual:string,wanted:string|RegExp)=>typeof wanted==='string'?actual.trim()===wanted:wanted.test(actual);
const text=(wanted:string|RegExp)=>[...document.querySelectorAll<HTMLElement>('*')].find(node=>match(node.textContent??'',wanted)&&![...node.children].some(child=>match(child.textContent??'',wanted)))??null;
function required<T>(value:T|null):T{if(value===null)throw new Error('Expected visible native test element');return value;}
async function waitFor<T>(check:()=>T):Promise<T>{const deadline=Date.now()+1500;while(true){try{return check();}catch(error){if(Date.now()>=deadline)throw error;await act(async()=>{await new Promise(done=>setTimeout(done,5));});}}}
const role=(name:string,wanted?:string|RegExp)=>[...document.querySelectorAll<HTMLElement>(name==='button'?'button':name==='combobox'?'select':name==='heading'?'h1,h2,h3,h4':name==='link'?'a':`[role="${name}"]`)].filter(node=>!wanted||match(node.getAttribute('aria-label')??node.textContent??'',wanted));
const screen={getByText:(wanted:string|RegExp)=>required(text(wanted)),queryByText:text,findByText:(wanted:string|RegExp)=>waitFor(()=>required(text(wanted))),getByRole:(name:string,options:{name?:string|RegExp})=>required(role(name,options.name)[0]??null),queryAllByRole:(name:string)=>role(name)};
const fireEvent={click:(node:HTMLElement)=>act(()=>node.click())};
const tenant='aaaaaaaa-0000-4000-8000-000000000001',agreement='bbbbbbbb-0000-4000-8000-000000000001';
const id='cccccccc-0000-4000-8000-000000000001',other='dddddddd-0000-4000-8000-000000000001',at='2026-10-21T20:00:00Z';
const row=()=>({id,revision_no:3,source_body_version:2,source_updated_at:at,title:'Saved original title',body_source:'paige_draft',retained_at:at,retained_by:null,snapshot_sha256:'a'.repeat(64)});
const page=()=>({agreement_id:agreement,current_source_version:2,current_updated_at:at,revisions:[row()],truncated:false,next_before_revision_no:null});
const body=()=>({...row(),agreement_id:agreement,contact_id:other,offer_id:null,commercial_terms_id:null,source_version_id:null,body_markdown:'Retained original advisory wording.',has_source_document:false});
const props=()=>({tenantId:tenant,agreementId:agreement,currentVersion:2,currentUpdatedAt:at,onClose:vi.fn(),onAccessRefused:vi.fn()});
beforeEach(()=>{read.mockReset().mockResolvedValue({ok:true,value:page()});wording.mockReset().mockResolvedValue({ok:true,value:body()});});
afterEach(cleanup);
it('reads actual selected wording, keeps version meanings distinct and does not blank an already selected revision',async()=>{
  const p=props();render(<AgreementWordingHistory {...p}/>);await screen.findByText('Retained original advisory wording.');
  expect(screen.getByText('Retained revision 3 · Content version 2')).toBeTruthy();
  const title=screen.getByRole('heading',{name:'Saved original title'});expect(document.activeElement).toBe(title);
  const picker=screen.getByRole('combobox',{}) as HTMLSelectElement;act(()=>{picker.dispatchEvent(new Event('change',{bubbles:true}));});expect(screen.getByText('Retained original advisory wording.')).toBeTruthy();expect(wording).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'Return to current agreement'}));expect(p.onClose).toHaveBeenCalledTimes(1);
});
it('does not turn an empty or failed history into an invented historical document',async()=>{
  read.mockResolvedValueOnce({ok:false,reason:'unconfirmed',message:'History connection not confirmed.'}).mockResolvedValueOnce({ok:true,value:{...page(),revisions:[]}});
  render(<AgreementWordingHistory {...props()}/>);await screen.findByText('History connection not confirmed.');expect(wording).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Retry history read'}));await screen.findByText('No retained wording was returned. The current document remains available.');expect(wording).not.toHaveBeenCalled();
});
it('preserves metadata but hides unverified selected text until explicit read recovery',async()=>{
  wording.mockResolvedValueOnce({ok:false,reason:'unconfirmed',message:'Selected read interrupted.'}).mockResolvedValueOnce({ok:true,value:body()});
  render(<AgreementWordingHistory {...props()}/>);await screen.findByText('Selected read interrupted.');expect(screen.queryByText('Retained original advisory wording.')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Retry selected wording'}));await screen.findByText('Retained original advisory wording.');expect(wording).toHaveBeenCalledTimes(2);
});
it('refuses mismatched retained metadata and retires the parent cached record on native access refusal',async()=>{
  const p=props();wording.mockResolvedValueOnce({ok:true,value:{...body(),snapshot_sha256:'b'.repeat(64)}}).mockResolvedValueOnce({ok:false,reason:'refused',message:'Access refused.'});
  render(<AgreementWordingHistory {...p}/>);await screen.findByText('The selected wording does not match its recorded history. Read the original history again.');expect(screen.queryByText('Retained original advisory wording.')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Retry selected wording'}));await waitFor(()=>expect(p.onAccessRefused).toHaveBeenCalledTimes(1));expect(screen.queryByText('Retained original advisory wording.')).toBeNull();
});
it('keeps uploaded references separate from verified readable files',async()=>{
  read.mockResolvedValue({ok:true,value:{...page(),revisions:[{...row(),body_source:'tenant_upload'}]}});wording.mockResolvedValue({ok:true,value:{...body(),body_source:'tenant_upload',has_source_document:true,body_markdown:null}});
  render(<AgreementWordingHistory {...props()}/>);await screen.findByText('Its retained file bytes cannot be verified in this view. Return to the current agreement to inspect available files.');expect(screen.queryAllByRole('link')).toHaveLength(0);
});
it('does not render a late wording response after leaving this record',async()=>{
  let resolve:(value:unknown)=>void;wording.mockReturnValueOnce(new Promise(done=>{resolve=done;}));const view=render(<AgreementWordingHistory {...props()}/>);
  await waitFor(()=>expect(wording).toHaveBeenCalledTimes(1));view.unmount();await act(async()=>{resolve({ok:true,value:body()});});expect(screen.queryByText('Retained original advisory wording.')).toBeNull();
});
it('follows the native older cursor and warns when the current source changed',async()=>{
  const first=page();read.mockResolvedValueOnce({ok:true,value:{...first,truncated:true,next_before_revision_no:3}}).mockResolvedValueOnce({ok:true,value:{...first,revisions:[{...row(),id:other,revision_no:1}]}});
  wording.mockResolvedValueOnce({ok:true,value:body()}).mockResolvedValueOnce({ok:true,value:{...body(),id:other,revision_no:1}});
  render(<AgreementWordingHistory {...props()} currentVersion={1}/>);await screen.findByText('Retained original advisory wording.');expect(screen.getByText(/current agreement changed after this page opened/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Read older wording'}));await waitFor(()=>expect(read).toHaveBeenLastCalledWith(tenant,agreement,3));await screen.findByText('Retained revision 1 · Content version 2');
});
