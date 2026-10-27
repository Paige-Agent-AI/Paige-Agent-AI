import React,{act,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {MemoryRouter,useLocation} from 'react-router-dom';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {CheckLinks} from '../components/chat/CheckLinks';
import {useSalesDraftExit} from '../solo/sales-dialog';

globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const original='/solo/3123/sales/agreements?agreement=e4000000-0000-4000-8000-0000000d0001';
const target='/solo/3123/sales/agreements?agreement=e4000000-0000-4000-8000-0000000d0002';
let root:Root,host:HTMLDivElement;
function Editor({busy=false,uncertain=false,to=target}:{busy?:boolean;uncertain?:boolean;to?:string}){
 const [draft,setDraft]=useState(''),guard=useSalesDraftExit(draft,busy,()=>{}, {uncertain});
 const location=useLocation();
 return <><button onClick={()=>setDraft('Private unsaved wording')}>Edit wording</button><p>{draft}</p>
  <output>{location.pathname+location.search}</output><CheckLinks links={[{label:'Open terms & agreements',to}]}/>{guard.confirmation}</>;
}
beforeEach(()=>{vi.stubGlobal('navigation',undefined);history.replaceState(null,'',original);host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();history.replaceState(null,'','/');vi.unstubAllGlobals();});
const open=(props:{busy?:boolean;uncertain?:boolean;to?:string}={})=>act(()=>root.render(<MemoryRouter initialEntries={[original]}><Editor {...props}/></MemoryRouter>));
const click=(text:string)=>act(()=>[...host.querySelectorAll<HTMLElement>('button,a')].find(node=>node.textContent===text)!.click());
const route=()=>host.querySelector('output')?.textContent;

describe('Chat record links respect the existing Sales leave guard before Router navigation',()=>{
 it('keeps dirty wording and original focus/route until the owner chooses to leave',()=>{
  open();click('Edit wording');const link=host.querySelector('a')!;link.focus();click('Open terms & agreements');
  expect(route()).toBe(original);expect(host.querySelectorAll('[role=alertdialog]')).toHaveLength(1);
  expect(document.activeElement?.textContent).toBe('Continue editing');click('Continue editing');
  expect(route()).toBe(original);expect(document.activeElement).toBe(link);expect(host.textContent).toContain('Private unsaved wording');
  const before=new Event('beforeunload',{cancelable:true});window.dispatchEvent(before);expect(before.defaultPrevented).toBe(true);
  click('Open terms & agreements');click('Discard changes');expect(route()).toBe(target);
 });
 it('refuses navigation while the original save is busy without claiming cancellation',()=>{
  open({busy:true});click('Open terms & agreements');expect(route()).toBe(original);expect(host.querySelector('[role=alertdialog]')).toBeNull();
 });
 it('retains the existing uncertain-save recovery decision',()=>{
  open({uncertain:true});click('Open terms & agreements');expect(route()).toBe(original);
  expect(host.textContent).toContain('An earlier save may still complete.');click('Leave and check later');expect(route()).toBe(target);
 });
 it('follows a clean exact-record link without adding a confirmation',()=>{
  open();click('Open terms & agreements');expect(route()).toBe(target);expect(host.querySelector('[role=alertdialog]')).toBeNull();
 });
 it.each([location.origin+target,'//'+location.host+target])('preserves same-origin absolute link behavior after explicit leave: %s',to=>{
  open({to});click('Edit wording');click('Open terms & agreements');expect(route()).toBe(original);
  click('Discard changes');expect(route()).toBe(target);
 });
 it('leaves modified clicks to the browser and never opens a Sales leave decision',()=>{
  open();click('Edit wording');const listener=vi.fn();window.addEventListener('paige:sales-before-navigation',listener);
  try{act(()=>host.querySelector('a')!.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true,button:0})));expect(listener).not.toHaveBeenCalled();expect(route()).toBe(original);expect(host.querySelector('[role=alertdialog]')).toBeNull();}
  finally{window.removeEventListener('paige:sales-before-navigation',listener);}
 });
});
