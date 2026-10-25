import React, {act, lazy, Suspense} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {PageLoadBoundary, PageLoadFailure} from './PageLoadBoundary';
import {mountApplicationLoadFailure} from '@/lib/mountApplicationLoadFailure';
import {useBeforeUnloadGuard} from '@/hooks/useBeforeUnloadGuard';
import {readFileSync} from 'node:fs';

describe('application load recovery',()=>{
  const roots:Root[]=[];
  afterEach(()=>{for(const root of roots)act(()=>root.unmount());roots.length=0;document.body.innerHTML='';vi.restoreAllMocks();});
  async function mount(node:React.ReactNode){const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);await act(async()=>root.render(node));return host;}
  it('keeps a real failed lazy route inside a recovery notice without disclosing the error',async()=>{
    vi.spyOn(console,'error').mockImplementation(()=>{});
    const failure=new Error('Failed to fetch dynamically imported module: https://example.invalid/private?token=private-value');
    const Page=lazy(()=>Promise.reject(failure));
    const host=await mount(<PageLoadBoundary><Suspense fallback="Loading"><Page/></Suspense></PageLoadBoundary>);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('This page couldn’t open');
    expect(host.querySelector('button')?.textContent).toBe('Reload page');
    expect(host.textContent).not.toMatch(/token|private-value|example.invalid/);
  });
  it('leaves successful content untouched',async()=>{const host=await mount(<PageLoadBoundary><div>Original authorized page</div></PageLoadBoundary>);expect(host.textContent).toBe('Original authorized page');expect(host.querySelector('button')).toBeNull();});
  it('retains the existing loading state until the module resolves',async()=>{
    let resolve!:(v:{default:React.ComponentType})=>void;
    const Page=lazy(()=>new Promise<{default:React.ComponentType}>(r=>{resolve=r;}));
    const host=await mount(<PageLoadBoundary><Suspense fallback={<p role="status">Loading</p>}><Page/></Suspense></PageLoadBoundary>);
    expect(host.textContent).toBe('Loading');await act(async()=>resolve({default:()=> <p>Original page</p>}));expect(host.textContent).toBe('Original page');
  });
  it('does not reload or touch authentication/storage merely because it renders',async()=>{const reload=vi.fn();const storage=vi.spyOn(Storage.prototype,'clear');await mount(<PageLoadFailure reload={reload}/>);expect(reload).not.toHaveBeenCalled();expect(storage).not.toHaveBeenCalled();});
  it('uses one explicit click for one reload',async()=>{const reload=vi.fn();const host=await mount(<PageLoadFailure reload={reload}/>);act(()=>host.querySelector('button')!.click());expect(reload).toHaveBeenCalledOnce();});
  it('blocks reload while another original editor has registered pending work',async()=>{
    const reload=vi.fn();function Work({active}:{active:boolean}){useBeforeUnloadGuard(active);return <PageLoadFailure reload={reload}/>;}
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);await act(async()=>root.render(<Work active/>));expect(host.querySelector('button')?.disabled).toBe(true);act(()=>host.querySelector('button')!.click());expect(reload).not.toHaveBeenCalled();expect(host.textContent).toContain('Finish or save');
    await act(async()=>root.render(<Work active={false}/>));expect(host.querySelector('button')?.disabled).toBe(false);act(()=>host.querySelector('button')!.click());expect(reload).toHaveBeenCalledOnce();
  });
  it('can render the same recovery before the main application graph is available',async()=>{const host=document.createElement('div');host.id='root';document.body.append(host);const splash=document.createElement('div');splash.id='paige-splash';document.body.append(splash);const unmount=vi.fn();window.addEventListener('paige:boot-splash-unmount',unmount,{once:true});let root:Root|null=null;await act(async()=>{root=mountApplicationLoadFailure();});expect(root).not.toBeNull();roots.push(root!);expect(host.querySelector('[role="alert"]')).not.toBeNull();expect(document.getElementById('paige-splash')).toBeNull();expect(unmount).toHaveBeenCalledOnce();expect(host.querySelector('[data-app-ready]')).toBeNull();});
  it('does nothing without a real application host',()=>{expect(mountApplicationLoadFailure()).toBeNull();});
  it('keeps recovery available when browser storage is denied',async()=>{vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('Storage denied');});vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Storage denied');});const host=await mount(<PageLoadFailure/>);expect(host.querySelector('button')?.disabled).toBe(false);});
  it('allows an original navigation to reset the failed route rather than trapping the next page',async()=>{vi.spyOn(console,'error').mockImplementation(()=>{});function Broken():never{throw new Error('Screen failed');}const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);await act(async()=>root.render(<PageLoadBoundary key="first"><Broken/></PageLoadBoundary>));expect(host.textContent).toContain('This page couldn’t open');await act(async()=>root.render(<PageLoadBoundary key="next"><p>Next original page</p></PageLoadBoundary>));expect(host.textContent).toBe('Next original page');});
  it('wires rejected boot and route downloads without the old automatic reload loop',()=>{
    const app=readFileSync('src/App.tsx','utf8');const main=readFileSync('src/main.tsx','utf8');const boot=readFileSync('src/boot-splash.tsx','utf8');
    expect(app).toContain('<PageLoadBoundary key={location.pathname}>');expect(app).toContain('const lazyPage = React.lazy;');expect(app).not.toContain('__chunk_reload__');expect(main).not.toContain('__chunk_reload__');expect(boot).toContain('import("./main.tsx").catch(mountApplicationLoadFailure)');expect(boot).not.toContain('import App');
  });
});
