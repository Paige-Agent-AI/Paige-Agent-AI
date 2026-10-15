import React from 'react';import {createRoot} from 'react-dom/client';
import {ThemeProvider,useTheme} from 'next-themes';
import {CommercialPackageInspection} from '../../../src/solo/sales/CommercialPackageInspection';
import {id,scenario} from './sdk';
export function Fixture(){const [mode,setMode]=React.useState('ready'),{resolvedTheme:theme,setTheme}=useTheme(),[epoch,setEpoch]=React.useState(0);
 (window as unknown as {reviewFixture:unknown}).reviewFixture={retire:()=>setEpoch(n=>n+1),release:()=>{scenario.mode='ready';scenario.release();},calls:()=>scenario.calls};
 return <main className="paige-solo solo-campaigns sb-workspace" data-theme={theme} style={{height:'auto',minHeight:'100dvh',padding:16,background:'var(--canvas)'}}>
  <aside aria-label="Synthetic proof controls"><label>State <select aria-label="State" value={mode} onChange={e=>{scenario.mode=e.target.value;setMode(e.target.value);setEpoch(n=>n+1);}}>{['ready','pending','missing','denied','error','long'].map(value=><option key={value}>{value}</option>)}</select></label><label>Theme <select aria-label="Theme" value={theme} onChange={e=>setTheme(e.target.value)}><option>light</option><option>dark</option></select></label><p>Actual source with synthetic record transports. No authentication, signing, send or payment.</p></aside>
  <section className="sb-panel"><header><h2>Invoice record</h2></header><CommercialPackageInspection key={epoch} tenantId={id(1)} invoiceId={id(4)} version={2} canPrepare/></section>
 </main>;
}createRoot(document.getElementById('root')!).render(<ThemeProvider defaultTheme="light" enableSystem={false} storageKey="e04-proof-theme"><Fixture/></ThemeProvider>);
