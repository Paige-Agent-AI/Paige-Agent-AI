import React, { useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MarkdownMessage } from '../../src/components/chat/MarkdownMessage';
import { WeeklyResponsibilityEntry } from '../../src/solo/weekly/WeeklyResponsibilityEntry';
import { useFixture, setFixture, observations } from './ports';
import '../../src/solo/solo-tokens.css';
import '../../src/solo/weekly/weekly-responsibility.css';
import './host.css';

// Neutral, offline design/interaction host. No model, account or business execution.
const forbidden = (name: string): never => { observations.network.push(name); throw Error('Offline fixture refuses '+name); };
window.fetch = () => forbidden('fetch');
window.WebSocket = class { constructor() { forbidden('WebSocket'); } } as any;
window.XMLHttpRequest = class { constructor() { forbidden('XMLHttpRequest'); } } as any;
navigator.sendBeacon = () => forbidden('beacon');
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle('dark', params.get('theme') === 'dark');
history.replaceState(null, '', '/solo/1701/operations/overview'+location.search);

const answers = {
 ready: `I compared **Weekly commitments** with your proposed time.\n\n| | Saved schedule | Proposed schedule |\n|---|---|---|\n| Day | Monday | Tuesday |\n| Time | 09:00 | 10:30 |\n| Time zone | America/New_York | America/New_York |\n\n**Nothing has changed.** The saved responsibility is paused; no next run is executable. This comparison does not authorize or enable future checks.\n\nOpen **Weekly responsibility**, find **Weekly commitments**, then choose **Future executions → Change schedule**. Review the original schedule before saving. Saving an unapproved definition and authorizing future checks are separate steps.`,
 loading: 'Reading the current weekly responsibility…',
 refused: 'Current owner access could not be verified. No schedule change was made. Return to your authorized workspace, then inspect Weekly responsibility before trying again.',
 unavailable: 'The current weekly responsibility could not be read within this request. No result or schedule change is confirmed. Inspect the original Weekly responsibility before repeating anything.',
 empty: 'No matching weekly responsibility was found in this bounded read. Please identify the saved responsibility you want to compare. Nothing was changed.',
 missing: 'Which day, local time and time zone should I compare with your saved responsibility? Nothing is changed or approved by preparing a comparison.',
};
function Host() {
 const m = useFixture();
 const [expanded, setExpanded] = useState(params.get('paige') !== 'closed');
 const [theme, setTheme] = useState(params.get('theme') === 'dark' ? 'dark' : 'light');
 const [request, setRequest] = useState('Compare my Weekly commitments schedule with Tuesday at 10:30 AM America/New_York. Do not change or authorize it.');
 const [shown, setShown] = useState(false);
 const sent = useRef(0);
 const state = m.status as keyof typeof answers;
 (window as any).weeklyFixture = { setFixture, observations, state: () => ({...m, shown, expanded, sent:sent.current}) };
 return <div className="paige-solo qa-host" data-pg={theme} data-theme={theme}>
  <details className="qa-controls"><summary>Offline engineering fixture</summary><p>Synthetic context and representative Chat wording. Actual Markdown renderer, weekly entry, sheet and schedule controls are unchanged source. All business/model/provider calls are disconnected; this is not authenticated acceptance.</p>
   <label>Read state<select value={m.status} onChange={e=>setFixture({status:e.target.value})}>{Object.keys(answers).map(s=><option key={s}>{s}</option>)}</select></label>
   <label>Control outcome<select value={m.result} onChange={e=>setFixture({result:e.target.value})}>{['refused','stale','unknown','unavailable'].map(s=><option key={s}>{s}</option>)}</select></label>
   <button onClick={()=>setFixture({scope:m.scope==='a'?'b':'a'})}>Switch neutral context</button>
   <button onClick={()=>{const n=theme==='dark'?'light':'dark';setTheme(n);document.documentElement.classList.toggle('dark',n==='dark');}}>Switch theme</button>
  </details>
  <main className={expanded?'qa-layout':'qa-layout qa-closed'}>
   <section className="qa-operations"><nav>Operations · Overview</nav><h1>Your operating week</h1><p>Return to your original work, schedule and receipts.</p><button onClick={()=>setExpanded(true)}>Open PAIGE</button><p className="qa-note">Neutral local frame. Production shell, live business data and new-account eligibility are not tested here.</p></section>
   {expanded && <section className="qa-chat" aria-label="PAIGE conversation">
    <header><strong>PAIGE</strong><button onClick={()=>setExpanded(false)}>Close PAIGE</button></header>
    <div className="qa-entry"><WeeklyResponsibilityEntry /></div>
    <div className="qa-transcript" aria-live="polite">{shown ? <><article className="qa-user">{request}</article><article className="qa-answer" aria-label="PAIGE schedule comparison"><MarkdownMessage content={answers[state]??answers.unavailable} verifiedAppPaths={[]} /></article></> : <p>Compare an existing weekly schedule before considering a change.</p>}</div>
    <form className="qa-composer" onSubmit={e=>{e.preventDefault();sent.current++;observations.messages.push({scope:m.scope,request});setShown(true);}}><label htmlFor="request">Local comparison request</label><textarea id="request" value={request} onChange={e=>setRequest(e.target.value)} /><button type="submit">Preview offline response</button></form>
   </section>}
  </main>
 </div>;
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><Host /></BrowserRouter>);
