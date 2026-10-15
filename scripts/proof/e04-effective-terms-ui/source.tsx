import React from 'react';import {createRoot} from 'react-dom/client';import {ThemeProvider,useTheme} from 'next-themes';
import {CommercialPackageInspection} from '../../../src/solo/sales/CommercialPackageInspection';import {scenario,id} from './sdk';
function Fixture(){const [mode,setMode]=React.useState('ready'),[epoch,setEpoch]=React.useState(0),{resolvedTheme:theme,setTheme}=useTheme();
 (window as unknown as {effectiveFixture:unknown}).effectiveFixture={state:()=>({writes:scenario.writes,applied:scenario.applied,calls:scenario.calls}),retireActor:()=>scenario.retireActor(),remount:()=>setEpoch(n=>n+1)};
 return <main className="paige-solo solo-campaigns sb-workspace" data-theme={theme} style={{height:'auto',minHeight:'100dvh',padding:16}}>
 <aside aria-label="Synthetic proof controls"><label>State <select aria-label="State" value={mode} onChange={event=>{scenario.reset(event.target.value);setMode(event.target.value);setEpoch(n=>n+1);}}>{['ready','changed','denied','unverified','missing','off','malformed','receipt_failed','unknown','recorded'].map(value=><option key={value}>{value}</option>)}</select></label>
 <label>Theme <select aria-label="Theme" value={theme} onChange={event=>setTheme(event.target.value)}><option>light</option><option>dark</option></select></label>
 <p>Actual mounted E04 source · synthetic Auth, database and function transports. No customer operation or acceptance.</p></aside>
 <section className="sb-panel"><header><h2>Invoice record</h2></header><CommercialPackageInspection key={epoch} tenantId={id(1)} invoiceId={id(4)} version={2} canPrepare/></section></main>;
}
createRoot(document.getElementById('root')!).render(<ThemeProvider defaultTheme="light" enableSystem={false} storageKey="e04-effective-proof-theme"><Fixture/></ThemeProvider>);
