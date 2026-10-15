import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PaigeConfirmCard,type ConfirmAction} from '../../../../src/components/chat/PaigeConfirmCard';
import '../../../../src/index.css';
const states=['entry','missing date','review','working','saved','refused','expired','offline','unknown','cancelled','workspace changed'];
const summary='Create an unissued $3,500.00 USD invoice draft for Test Customer, requesting $500.00 as the deposit with $3,000.00 remaining after the deposit, due 2026-11-01. This saves a draft only; it does not publish, send, activate a plan or collect payment.';
const fp='0123456789abcdef';
function App(){const [state,setState]=useState('entry');const [date,setDate]=useState('');const [theme,setTheme]=useState('dark');const [open,setOpen]=useState(true);document.documentElement.classList.toggle('dark',theme==='dark');
let action:ConfirmAction={summary:date?summary.replace('2026-11-01',date):summary,fingerprint:fp};
if(state==='working')action={...action,state:'working'};
if(state==='saved')action={...action,state:'done',note:'Canonical draft saved and read back. It has not been issued, sent or paid.'};
if(['refused','expired','offline','workspace changed'].includes(state))action={...action,state:'failed',note:state==='expired'?'The approval expired. Request a fresh exact review.':state==='workspace changed'?'Workspace changed. No draft command was executed. Return to the intended workspace.':state==='offline'?'The service was unavailable before dispatch. No draft command was sent.':'Your current policy does not permit this action. No draft command was executed.'};
if(state==='unknown')action={...action,state:'unconfirmed',note:'The response did not establish completion. Read the existing operation before retrying; a draft may have been saved.'};
const reviewing=!['entry','missing date','cancelled'].includes(state);
return <div style={{minHeight:'100dvh',background:'hsl(var(--background))',color:'hsl(var(--foreground))'}}>
<header style={{padding:16,borderBottom:'1px solid hsl(var(--border))'}}>LOCAL PROTOTYPE — fixture customer; all saves, approvals and network outcomes simulated.</header>
<aside aria-label="Prototype controls" style={{padding:12,display:'flex',gap:8,flexWrap:'wrap'}}><label>State <select aria-label="State" value={state} onChange={e=>setState(e.target.value)}>{states.map(s=><option key={s}>{s}</option>)}</select></label><label>Theme <select aria-label="Theme" value={theme} onChange={e=>setTheme(e.target.value)}><option>dark</option><option>light</option></select></label><button onClick={()=>setOpen(!open)}>PAIGE {open?'open':'closed'}</button></aside>
<main style={{display:'flex',minHeight:'65dvh',padding:16,gap:16}}><section style={{flex:1,minWidth:0}}><h1>Sales · Invoices</h1><p>Prototype register. Creating a draft does not issue an invoice or collect a payment.</p>{state==='saved'&&<p>Test Customer · $3,500.00 · Draft · $500.00 deposit</p>}</section>
{open&&<section aria-label="PAIGE conversation" style={{width:'min(600px,100%)',minWidth:0}}>
<p>Create a $3,500 invoice draft for Test Customer with a $500 deposit.</p>
{state==='entry'&&<button onClick={()=>setState('missing date')}>Continue prototype</button>}
{state==='missing date'&&<form onSubmit={e=>{e.preventDefault();if(date)setState('review')}}><label>What due date should I use? <input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label><button type="submit">Continue</button><button type="button" onClick={()=>setState('cancelled')}>Cancel</button><p>This local draft demonstrates the date question. The shared objective-resume integration remains unverified.</p></form>}
{reviewing&&<PaigeConfirmCard actions={[action]} {...(state==='review'?{mode:'decide' as const,onApprove:()=>setState('working'),onDeny:()=>setState('cancelled')}:{mode:'report' as const,recovery:['refused','expired','offline'].includes(state)?{onPress:()=>setState('review')}:undefined})} focusOnMount/>}
{state==='working'&&<button onClick={()=>setState('saved')}>Simulate canonical readback</button>}
{state==='unknown'&&<button onClick={()=>setState('saved')}>Simulate recovery of same operation</button>}
{state==='cancelled'&&<><p>No command was dispatched. The conversation can continue.</p><button onClick={()=>setState('entry')}>Start again</button></>}
<p role="status">Prototype state: {state}. No real invoice, approval, email or payment has been created.</p>
</section>}
</main><style>{`select,input,button{padding:8px;border:1px solid hsl(var(--border));border-radius:8px;background:hsl(var(--card));color:hsl(var(--foreground))} @media(max-width:760px){main{flex-direction:column}main section{width:100%!important}}`}</style></div>}
createRoot(document.getElementById('root')!).render(<App/>);
