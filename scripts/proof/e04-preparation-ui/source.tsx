import React from 'react';
import {createRoot} from 'react-dom/client';
import {ThemeProvider,useTheme} from 'next-themes';
import {CommercialPackageInspection} from '../../../src/solo/sales/CommercialPackageInspection';
import {scenario,id} from './sdk';
function Fixture(){
 const [mode,setMode]=React.useState('ready'),[epoch,setEpoch]=React.useState(0),[navigation,setNavigation]=React.useState(''),{resolvedTheme:theme,setTheme}=useTheme();
 (window as unknown as {preparationFixture:unknown}).preparationFixture={state:()=>scenario.state(),retireActor:()=>scenario.retireActor(),remount:()=>setEpoch(n=>n+1)};
 return <main className="paige-solo solo-campaigns sb-workspace" data-theme={theme} style={{height:'auto',minHeight:'100dvh',padding:16}}>
  <aside aria-label="Synthetic proof controls"><label>State <select aria-label="State" value={mode} onChange={event=>{scenario.reset(event.target.value);setMode(event.target.value);setNavigation('');setEpoch(n=>n+1);}}>{['ready','missing','denied','off','malformed_text','malformed_fact','receipt_failed','unknown','malformed_receipt','prepared'].map(value=><option key={value}>{value}</option>)}</select></label>
   <label>Theme <select aria-label="Theme" value={theme} onChange={event=>setTheme(event.target.value)}><option>light</option><option>dark</option></select></label>
   <p>Actual mounted E04 source. Synthetic Auth, database and function ports. No customer operation, signature, send, payment or acceptance.</p></aside>
  <section className="sb-panel"><header><h2>Invoice record</h2></header><CommercialPackageInspection key={epoch} tenantId={id(1)} invoiceId={id(6)} version={1} canPrepare canManage onManageSignatures={async(target,current)=>{
   if(!current())return {ok:false};scenario.navigation.push(target);setNavigation('Exact agreement selected. The incumbent signature manager is covered separately by the owner workspace contract tests.');return {ok:true};
  }}/>{navigation&&<p role="status">{navigation}</p>}</section>
 </main>;
}
createRoot(document.getElementById('root')!).render(<ThemeProvider defaultTheme="light" enableSystem={false} storageKey="e04-preparation-proof-theme"><Fixture/></ThemeProvider>);
