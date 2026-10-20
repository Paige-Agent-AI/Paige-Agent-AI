/** DEV-ONLY rendered flow. Canonical-shaped synthetic transport, no backend calls. */
import { useState } from 'react';
import { WeeklyDraftForm, WeeklyDraftReview } from '@/solo/weekly/WeeklyDraftReview';
import type { WeeklyDraftIntent, WeeklyDraftState } from '@/solo/weekly/weekly-draft-command';
import { WEEKDAYS } from '@/solo/weekly/weekly-responsibility';
const id='30000000-0000-4000-8000-000000000005';
const receipt='70000000-0000-4000-8000-000000000005';
export function WeeklyDraftPrototype(){
  const [state,setState]=useState<WeeklyDraftState|null>(null),[mode,setMode]=useState('normal'),[busy,setBusy]=useState(false);
  function prepare(draft:WeeklyDraftIntent){setState({phase:'awaiting_approval',draft,confirmationId:id,requestId:id,
    readAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),token:'0123456789abcdef:'+id,
    summary:`Save “${draft.name}” as an unapproved draft: every ${WEEKDAYS[draft.weekday-1]} at ${draft.local_time} in ${draft.timezone}. Scope: your outstanding personal Planning commitments. No recurrence, task changes or provider sends are authorized.`,
    automationId:null,processState:null,revision:null,receiptId:null});}
  function outcome(phase:WeeklyDraftState['phase']){setBusy(false);setState(s=>s?{...s,phase,token:null,
    automationId:phase==='saved'?id:null,revision:phase==='saved'?1:null,processState:phase==='saved'?'draft':null,receiptId:phase==='saved'?receipt:null}:s);}
  function save(){setBusy(true);window.setTimeout(()=>outcome(mode==='unknown'?'unknown':'saved'),900);}
  return <div className="e5-weekly-panel"><h2>Weekly responsibility</h2><p>Prepare your week, then verify the saved proposal in Calendar.</p>
    <label>Local response fixture <select value={mode} onChange={e=>setMode(e.target.value)}><option value="normal">Verified draft save</option><option value="unknown">Lost response / unknown</option><option value="unavailable">Unavailable status</option></select></label>
    {!state?<WeeklyDraftForm businessZone="America/New_York" busy={false} onPrepare={prepare} onCancel={()=>undefined}/>:<><WeeklyDraftReview state={state} busy={busy} unavailable={mode==='unavailable'} onApprove={save} onDecline={()=>outcome('declined')} onReadback={()=>{if(mode==='unknown')outcome('saved');}}/>
      <button type="button" disabled={busy||state.phase==='unknown'} onClick={()=>setState(null)}>Change proposal</button></>}
    <nav className="e5-weekly-navigation"><a href="?surface=calendar&state=requested">Clients → Calendar</a><a href="?surface=calendar&state=completed">View a synthetic checked result</a></nav>
  </div>;
}
