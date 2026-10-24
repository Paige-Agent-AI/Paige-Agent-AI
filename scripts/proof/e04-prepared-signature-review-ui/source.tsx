import '../../../src/index.css';
import '../../../src/solo/solo-tokens.css';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ThemeProvider} from 'next-themes';
import {AgreementDocumentPreparation,type DocumentGuard} from '../../../src/solo/sales/AgreementDocumentPreparation';
import {useSalesDraftExit} from '../../../src/solo/sales-dialog';
import original from '../../../src/solo/sales/fixtures/agreement-document-source.json';
import {fixture,reset} from './sdk';
import './prototype.css';

function ActualPane({generation,onRefused}:{generation:number;onRefused:()=>void}){
  const [guard,setGuard]=React.useState<DocumentGuard>({draft:[],busy:false,uncertain:false}),[request,setRequest]=React.useState<string|null>(null),[returned,setReturned]=React.useState(false);
  const exit=useSalesDraftExit(guard.draft,guard.busy,()=>setReturned(true),{uncertain:guard.uncertain});
  React.useLayoutEffect(()=>exit.adoptBaseline([]),[exit.adoptBaseline]);
  return returned?<div className="e04-preparation"><h3>Returned to the originating agreement</h3><button onClick={()=>setReturned(false)}>Reopen signing document</button></div>:<div className="e04-preparation"><AgreementDocumentPreparation tenantId={original.source.tenant_id} agreementId={original.source.agreement_id} actorId={fixture.actor} requestId={request}
    authorityKey={'synthetic-source:'+generation} isCurrent={()=>exit.alive.current} resume={guard} onGuard={(value,baseline)=>{setGuard(value);if(baseline)exit.adoptBaseline(baseline);}}
    onRetainRequest={id=>{setRequest(id);return true;}} onRequest={exit.request} onReturn={()=>setReturned(true)} onAddSigners={()=>setReturned(true)} onAccessRefused={onRefused}/>{exit.confirmation}</div>;
}
function Source(){
  const [theme,setTheme]=React.useState('light'),[mode,setMode]=React.useState('ready'),[generation,setGeneration]=React.useState(0),[refused,setRefused]=React.useState(false);
  const change=(value:string)=>{reset(value);setMode(value);setGeneration(v=>v+1);setRefused(false);};
  return <ThemeProvider forcedTheme={theme} attribute="class" enableSystem={false}><div className="paige-solo c23-proof" data-theme={theme} data-pg={theme}>
    <details className="c23-proof-toolbar"><summary>Local verification controls · synthetic records</summary><div className="c23-proof-controls"><label>Fixture state<select aria-label="Fixture state" value={mode} onChange={e=>change(e.target.value)}>{['ready','issues','loading','network','source_changed','access_denied','empty','save_unknown'].map(v=><option key={v}>{v}</option>)}</select></label><button onClick={()=>setTheme(t=>t==='light'?'dark':'light')}>Toggle theme</button><button onClick={()=>{fixture.pending?.();fixture.pending=null;}}>Resolve pending read</button><button onClick={()=>change(mode)}>Retire business context</button><p>No real identity, backend, approval, provider, notification, signature, payment or service result. Canonical API/components use synthetic local ports only.</p></div></details>
    <main className="c23-proof-workspace">{refused?<div className="e04-preparation"><h3>Agreement access unavailable</h3><p>The original parent received access refusal and retired the private pane.</p><button onClick={()=>change('ready')}>Reopen local fixture</button></div>:<ActualPane key={generation} generation={generation} onRefused={()=>setRefused(true)}/>}</main>
  </div></ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<Source/>);
