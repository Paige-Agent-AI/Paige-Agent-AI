import React, {act} from 'react';
import type {Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const fixture=vi.hoisted(()=>({roots:[] as Root[],appFails:false,providerFails:false}));
vi.mock('react-dom/client',async()=>{
  const actual=await vi.importActual<typeof import('react-dom/client')>('react-dom/client');
  return {...actual,createRoot:(...args:Parameters<typeof actual.createRoot>)=>{
    const root=actual.createRoot(...args);fixture.roots.push(root);return root;
  }};
});
vi.mock('../App.tsx',()=>({default:function ApplicationFixture(){
  const[count,setCount]=React.useState(0);
  if(fixture.appFails)throw new Error('Synthetic private application detail');
  return <main><button onClick={()=>setCount(count+1)}>Original action</button><output>{count}</output></main>;
}}));
vi.mock('react-helmet-async',()=>({HelmetProvider:({children}:{children:React.ReactNode})=>{
  if(fixture.providerFails)throw new Error('Synthetic private provider detail');
  return children;
}}));
vi.mock('../lib/observability',()=>({initObservability:vi.fn()}));
vi.mock('../pages/public/SandboxedFormNotice',()=>({SandboxedFormNotice:()=>null}));

describe('actual application bootstrap render recovery',()=>{
  const expectedError=(event:ErrorEvent)=>{
    if(event.message.includes('Synthetic private'))event.preventDefault();
  };
  beforeEach(()=>{
    vi.resetModules();fixture.appFails=false;fixture.providerFails=false;
    vi.stubGlobal('requestAnimationFrame',vi.fn());
    window.history.replaceState(null,'','/app');
    document.body.innerHTML='<div id="root"></div>';
    window.addEventListener('error',expectedError);
    vi.spyOn(console,'error').mockImplementation(()=>{});
  });
  afterEach(async()=>{
    for(const root of fixture.roots.splice(0))await act(async()=>root.unmount());
    window.removeEventListener('error',expectedError);
    vi.restoreAllMocks();vi.unstubAllGlobals();document.body.innerHTML='';
  });
  const boot=async()=>{
    // The baseline genuinely throws out of React. Catch that deliberate fixture
    // exception so the assertion records its missing UI, never an unhandled test.
    try{await act(async()=>{await import('../main.tsx');});}catch(error){
      if(!(error instanceof Error)||!error.message.includes('Synthetic private'))throw error;
    }
  };
  it('retains the original healthy application, ready marker and stateful controls',async()=>{
    await boot();expect(document.querySelectorAll('[data-app-ready]')).toHaveLength(1);
    const button=document.querySelector('button')!;
    act(()=>button.click());expect(document.querySelector('output')?.textContent).toBe('1');
    expect(document.querySelector('[role="alert"]')).toBeNull();expect(fixture.roots).toHaveLength(1);
  });
  it.each(['app','provider'] as const)('shows original recovery when %s rendering fails before a route boundary',async kind=>{
    fixture.appFails=kind==='app';fixture.providerFails=kind==='provider';
    const clear=vi.spyOn(Storage.prototype,'clear');
    await boot();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(document.querySelector('h1')?.textContent).toBe('This page couldn’t open');
    expect(document.querySelector('button')?.textContent).toBe('Reload page');
    expect(document.querySelector('[data-app-ready]')).toBeNull();
    expect(document.body.textContent).not.toContain('Synthetic private');
    expect(clear).not.toHaveBeenCalled();expect(fixture.roots).toHaveLength(1);
  });
});
