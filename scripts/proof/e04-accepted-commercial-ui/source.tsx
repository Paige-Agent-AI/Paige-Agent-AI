import React from 'react';
import {createRoot} from 'react-dom/client';
import {CommercialPackageInspection} from '../../../src/solo/sales/CommercialPackageInspection';
import {fixture} from './sdk';
import {ThemeProvider} from 'next-themes';
import '../../../src/index.css';
import '../../../src/solo/solo-tokens.css';
import '../../../src/solo/sales/sales-billing.css';

function Source(){
 const [theme,setTheme]=React.useState('light'),[generation,setGeneration]=React.useState(0),[other,setOther]=React.useState(false);
 const [epoch,setEpoch]=React.useState(0),[ownerAccess,setOwnerAccess]=React.useState(true);
 return <ThemeProvider attribute="class" forcedTheme={theme} enableSystem={false}><div className="paige-solo" data-theme={theme} style={{minHeight:'100dvh',height:'auto'}}>
  <nav aria-label="Local verification controls" style={{padding:16,display:'flex',gap:12,flexWrap:'wrap'}}>
   <strong>Synthetic original-component proof</strong><label>Response <select aria-label="Fixture response" value={fixture.mode} onChange={e=>{fixture.mode=e.target.value;setGeneration(n=>n+1);}}>
    {['recorded','legacy','unverified','refused','changed','pending'].map(mode=><option key={mode}>{mode}</option>)}
   </select></label><button onClick={()=>setTheme(v=>v==='dark'?'light':'dark')}>Toggle theme</button>
   <button onClick={()=>{fixture.pending?.();fixture.pending=null;}}>Resolve pending read</button>
   <button onClick={()=>setOther(v=>!v)}>Change workspace</button>
   <button onClick={()=>setEpoch(v=>v+1)}>Change account epoch</button>
   <button onClick={()=>setOwnerAccess(v=>!v)}>{ownerAccess?'Withdraw owner access':'Restore owner access'}</button>
   <label>Effective-terms response <select aria-label="Effective terms fixture" value={fixture.effect} onChange={e=>{fixture.effect=e.target.value;setGeneration(n=>n+1)}}>{['review','active','refused','unknown','bad-receipt','pending'].map(mode=><option key={mode}>{mode}</option>)}</select></label>
   <button onClick={()=>{fixture.effectPending?.();fixture.effectPending=null}}>Resolve pending operation</button>
  </nav>
  <main className="sb-workspace" style={{height:'auto',maxWidth:1040,margin:'auto',padding:20}}><h1 style={{fontSize:24}}>Invoice commercial record</h1>
   <p>Local verification only. Original mounted components and parsers; synthetic Auth/RPC records. No provider, file, signature or customer acceptance.</p>
   <CommercialPackageInspection key={generation} tenantId={other?'00000099-0000-4000-8000-000000000001':fixture.tenant} invoiceId={fixture.invoice} version={2} accountEpoch={`${other?'b':'a'}:${epoch}`} canInspectAccepted={!other&&ownerAccess}/>
  </main>
 </div></ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<Source/>);
