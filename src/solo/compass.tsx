// @ts-nocheck
import React from "react";
import { Ic, Foldout, PageHead, Wrap } from "./_shared";
import { useSoloActivityFeed, departmentLabel, elapsedLabel } from "./data/useSoloActivityFeed";
import { useSoloPendingActions, type SoloPendingAction } from "./data/useSoloPendingActions";
import { useSoloTrust } from "./data/useSoloTrust";
import { useSoloToolGovernance } from "./data/useSoloToolGovernance";
import {
  CAPABILITY_DOMAINS, POSTURE_LABEL, rankOfMode, modeOfRank, maxModeForRisk, clampModeToRisk,
  type Posture, type ToolMode,
} from "./data/capabilityTools";

// TC_DEPTS / TRUST — REPLACED 2026-09-03, recorded rather than deleted quietly (§13/§58).
//
// What was here: ten INVENTED departments (`exec`, `mkt`, `cs`, `prod`, `tech`, `fin`, `ppl`,
// `legal`, `ops`, `sales`) each carrying a hardcoded trust float, a hardcoded confidence percent,
// a hardcoded week-over-week trend, and a hardcoded triple of work counts — seeded into a
// module-level singleton that any slider mutated and that died on reload.
//
// The platform has ELEVEN departments and they are not those ten; only `sales` overlaps. So the
// surface was not showing wrong numbers for the right organisation, it was showing a different
// organisation. And the floats were not compass-local: `vault.tsx` rendered a document's pill and
// `systems.tsx` decided a fix's state from them, so a hardcoded `.22` decided what a Solo owner
// was told about how their legal work is governed.
//
// What replaces it: `useSoloTrust`, which reads the real `paige_departments` and the real
// `paige_action_kinds` default lanes. The derived level is a DOCUMENTED mapping from real rows
// (auto=1, confirm=0.5, off=0), not a constant.
//
// THE LABEL MATTERS AS MUCH AS THE NUMBER. Every one of those rows has `tenant_id IS NULL` — they
// are PLATFORM DEFAULTS, identical for every workspace. Nothing here may say or imply that this
// workspace approved, chose, or personally authorised a level of autonomy, because no such record
// exists anywhere in the platform. The vocabulary below says "platform default" and the control is
// READ-ONLY for exactly that reason.
//
// GONE, NOT DEFAULTED, because nothing produces them (§13 — a plausible substitute is the same
// defect with better manners): the confidence percentage and its 30-day sparkline, the
// week-over-week trend, the per-action-type sliders whose values were arithmetic on the invented
// float, and the "Last actions here" list — six hardcoded outcomes, each with an elapsed time and
// a claim about whether she ran it or you approved it, asserting a per-department history that
// never happened. That last one is the same class as TC_LIVE above and goes for the same reason.
// (Paraphrased deliberately: useSoloTrust.test.ts greps this file for the original wording, and a
// note quoting it verbatim would make the guard match its own explanation — the same recursion the
// TC_DRAFT note above had to avoid.)

const TC_AMBER=.24;
export const tierLabel={green:'Runs on the platform default',amber:'Drafts for you by default',red:'Always your call'};

/** Presentation glyph per real department slug. Plumbing for `Ic[...]`, not a data claim. */
const DEPT_ICON={owner_ops:'grid',client_experience:'users',executive_office:'shield',marketing:'trend',
 sales:'store',product_curriculum:'grid',technology_automation:'bolt',finance:'chart',
 people_talent:'users',legal_compliance:'vault',operations_pmo:'gear'};

/**
 * A department's tier from its REAL default lane mix. `null` when the department has no enabled
 * action kinds at all — an absent posture is absent, never rendered as "always your call", which
 * would be a governance claim about a desk nothing is routed to.
 */
export const tierOfLevel=g=>g==null?null:g>=.6?'green':g>=.34?'amber':'red';

/** The lane an action kind runs in, as a tier. Unknown lanes yield null and are never drawn. */
export const laneTier=lane=>({auto:'green',confirm:'amber',off:'red'})[lane]||null;

/**
 * What an orb says. It names a REAL action kind and the lane the platform default puts it in —
 * never that the act happened. The version this replaces drew the tier from `Math.random()` and
 * appended "— auto-performed" / "— drafted, waiting on you", asserting an execution the catalogue
 * behind it does not record; it also concatenated the act OBJECT once `acts` became {label, lane},
 * rendering "[object Object]" in the toast.
 */
export const orbLabel=(d,act)=>d.n+' · '+act.label+
 ({auto:' — runs automatically by default',confirm:' — drafted for you by default',off:' — always your call'}[act.lane]||'');

/**
 * The real per-department posture, in the shape the markup below already consumes.
 *
 * `g` is the derived platform-default level · `w` is the real [auto, confirm, off] count of
 * enabled action kinds routed to the desk · `acts` are the platform's own labels for those kinds.
 * There is no `conf` and no `trend`: nothing produces either.
 */
export const useTrustDepartments=(accountEpoch)=>{
 const t=useSoloTrust(accountEpoch);
 return React.useMemo(()=>({
  loading:t.loading,
  configured:t.configured,
  error:t.error,
  depts:t.departments.map(d=>({
   id:d.slug,n:d.name,ic:DEPT_ICON[d.slug]||'grid',
   g:d.defaultLevel,w:[d.lanes.auto,d.lanes.confirm,d.lanes.off],
   acts:d.acts,kinds:d.kinds,openCount:d.openCount,
   awaitingCount:d.awaitingCount,workingCount:d.workingCount,
  })),
 }),[t]);
};

/** slug -> derived platform-default level (or null). Kept as a map so existing call sites index it. */
export const useTrust=(accountEpoch)=>{
 const{depts}=useTrustDepartments(accountEpoch);
 return React.useMemo(()=>Object.fromEntries(depts.map(d=>[d.id,d.g])),[depts]);
};

/**
 * Tier for a department, from a levels map. PURE and map-taking on purpose: the value is now read
 * asynchronously, so a module-level `deptTier(id)` reading a singleton could only ever have
 * answered from a fixture. Returns null when the department is unknown or has no posture.
 */
export const deptTier=(levels,id)=>tierOfLevel(levels?.[id]??null);

// TC_LIVE — REMOVED 2026-09-01, and recorded here rather than deleted quietly (§13/§58).
//
// This const held eight lines of invented activity — named clients who do not exist, a named
// recipient, timings down to "4s ago" — rendered under a green "Live" pill beneath the heading
// "the last few minutes, as they happened". A placeholder is one thing. A placeholder that
// asserts liveness and names customers is a claim, and the standing boundary on this work is
// exact: do not invent activity, revenue, permissions, provider state, customer records, or
// successful actions.
//
// The panel reads the Rail — the row `record_rail_event` writes when something actually happens —
// through `useSoloActivityFeed`. Since the Slice B consumer repair that hook calls the deployed
// resolver `get_solo_rail_activity` rather than selecting from `paige_client_events` directly, so
// the workspace boundary is re-enforced in the function body (§59) instead of resting on
// `pce_staff_read`, whose `has_any_role` check is tenant-agnostic. The markup below is unchanged;
// only where the values come from has changed, which is the whole of the fix.
//
// ONE THING THE RAIL CANNOT SAY, so the feed does not say it. The amber/red tiers mean "waiting
// on you" and "your decision". A Rail row is a record that something HAPPENED and carries no
// approval state, so every real line resolves to `green` — performed and logged — and nothing
// synthesises the other two. Approval state lives in `paige_actions`; a feed that wants it needs
// that seam wired, not a guess dressed as a tier.
//
// STILL FABRICATED, NOT ADDRESSED HERE: `TC_DRAFT` and `TC_ESC` below. They remain reachable from
// the canvas orbs (`onOrb`), whose tier comes from the simulated dial rather than from this feed,
// so wiring the feed removes no affordance (§58). They are their own finding — TC_ESC in
// particular renders a specific recommendation about a fabricated lapsed insurance policy.
// TC_DRAFT and TC_ESC — REMOVED 2026-09-01, recorded rather than deleted quietly (§13/§58).
//
// TC_DRAFT was a complete outbound email: a named recipient at a named company, a named sender, a
// subject, a body, a "why she drafted it" rationale citing behaviour that never occurred ("she
// opened the last two teardowns"), and a confidence of 91%. Approving it raised a toast reading
// "Sent." — a claim that mail had gone to a person who does not exist.
//
// TC_ESC was a legal escalation: a workers' compensation policy said to have lapsed on a specific
// date, a named carrier, three courses of action, and a recommendation to reinstate. An operator
// reading it would have been reading a statutory coverage position invented in a source file.
// (Paraphrased deliberately — compass.fabrications.test.ts greps this file for the original
// wording, and a note that quotes it verbatim makes the guard match its own explanation.)
//
// Between them that is four of the six things the standing boundary names — an invented customer
// record, invented provider state, an invented measurement, and a fabricated successful action.
//
// THE CANVAS DIAL — REPLACED 2026-09-05 by the governed knob surface below (§32/§36 accessibility).
// The `<canvas>` orbit read the platform-default department lanes correctly, but it was mouse-only
// (no keyboard, no screen-reader path), it spawned orbs from `Math.random()` that rose and fell
// like activity, and it offered no real control — the boundary it drew reflected platform policy a
// workspace cannot set. What replaces it is an accessible instrument wired to the ONE thing a
// workspace can genuinely govern: per-tool autonomy via `set_tool_autonomy` (`useSoloToolGovernance`),
// with the platform-default department lanes kept as an honest READ-ONLY reference (`useSoloTrust`,
// unchanged). No random motion, a full keyboard/screen-reader path, and no control that pretends to
// an authority the platform does not enforce (§70.1).
//
// The two modals `TcApprove` / `TcEscalate` — REMOVED with the dial. Their primary buttons (an
// approve-and-send and a decide-and-log — paraphrased deliberately, since compass.fabrications.test.ts
// greps this file for those exact strings and a note quoting them verbatim would make the guard match
// its own explanation) only closed the modal, a false affordance (§70.1): the real approval seam is
// the ONE Paige chat confirm card (`paige_pending_confirmations` + `PaigeConfirmCard`), so pending
// work now ROUTES to that one home (§18) via `openPaige` rather than a second inbox built here. The
// pending count is still a REAL read of `paige_actions` through `useSoloPendingActions`.

// ── posture presentation (the five owner-approved states) ────────────────────────────────────
const POSTURE_META={
 guardrails:{label:POSTURE_LABEL.guardrails,col:'var(--ok)',tint:'var(--ok-tint)',pill:'pill-ok'},
 asks:{label:POSTURE_LABEL.asks,col:'var(--warn)',tint:'var(--warn-tint)',pill:'pill-warn'},
 held:{label:POSTURE_LABEL.held,col:'var(--bad)',tint:'var(--bad-tint)',pill:'pill-bad'},
 your_call:{label:POSTURE_LABEL.your_call,col:'var(--violet)',tint:'var(--violet-tint)',pill:'pill-n'},
 not_ready:{label:POSTURE_LABEL.not_ready,col:'var(--ink-3)',tint:'var(--surface-sunk)',pill:'pill-n'},
};
const MODE_LABEL={off:'Held',confirm:'Asks first',auto:'Acts within guardrails'};
const modeCol=m=>m==='auto'?'var(--ok)':m==='confirm'?'var(--warn)':'var(--bad)';
const useReduced=()=>{const[r,setR]=React.useState(false);React.useEffect(()=>{
 if(typeof matchMedia!=='function')return; // no window.matchMedia (some test/SSR envs) → assume motion on
 const m=matchMedia('(prefers-reduced-motion: reduce)');const f=()=>setR(!!m.matches);f();
 m.addEventListener?.('change',f);return()=>m.removeEventListener?.('change',f);},[]);return r;};

// ── the accessible knob: a real 3-detent slider (off/confirm/auto), capped at `max` ──────────
// `mixed` (domain knobs only): the underlying tools are at different levels, so selecting the
// displayed level must still commit (normalise all of them) rather than no-op on equality.
const TcKnob=({value,max,onCommit,ariaLabel,onError,mixed})=>{
 const maxRank=rankOfMode(max);
 const disabled=maxRank<=0; // owner_only (max off) is not a settable knob
 const rank=rankOfMode(value);
 const[pending,setPending]=React.useState(null);
 const[saving,setSaving]=React.useState(false);
 const shown=pending!=null?pending:rank;
 const mounted=React.useRef(true);
 React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 // When a saved change is re-read, the real `value` prop arrives and the optimistic hold is dropped
 // in the SAME frame it lands — clearing `pending` inside the success callback instead would snap the
 // knob back to the stale prop for a frame first (the post-save flicker). On success we therefore keep
 // the optimistic value until the refreshed prop replaces it; on failure we clear it at once.
 React.useEffect(()=>{setPending(null);},[value]);
 // SERIALIZE writes so the LAST choice wins. Rapid input (auto→confirm→off before the first save
 // returns) must never fire overlapping RPCs that can land out of order and leave the DB at a MORE
 // permissive value than the user's final choice — a real governance hazard. Only one write is in
 // flight; `desired` holds the newest requested rank and the drain writes it once the prior settles.
 const desired=React.useRef(null);
 const draining=React.useRef(false);
 const drain=React.useCallback(async()=>{
  if(draining.current)return;draining.current=true;
  try{
   while(desired.current!=null){
    const target=desired.current;desired.current=null;
    if(mounted.current)setSaving(true);
    let failed=false,errVal;
    try{const res=await Promise.resolve(onCommit(modeOfRank(target)));
     if(res&&res.ok===false){failed=true;errVal=res.error;}}
    catch(err){failed=true;errVal=err;}
    // A newer choice queued while this write was in flight is the user's CURRENT intent — pursue it
    // (loop again) rather than reverting to it; only a failure with nothing newer queued is final, and
    // only then do we drop the optimistic hold and surface the error. Never silently strand the last
    // choice behind a superseded write's failure (§70.1/§13).
    if(failed&&desired.current==null){if(mounted.current)setPending(null);onError&&onError(errVal);return;}
   }
  }finally{draining.current=false;if(mounted.current)setSaving(false);}
 },[onCommit,onError]);
 const commit=React.useCallback((r)=>{r=Math.max(0,Math.min(maxRank,r));
  // No-op ONLY when the target already matches the persisted prop AND nothing is in flight or queued.
  // If a DIFFERENT write is still saving (draining) or queued, a return to the persisted value must be
  // ENQUEUED so it overrides that in-flight write — clearing here would let the stale in-flight value
  // (e.g. a 'confirm' the user has since backed out of) persist, more permissive than the last choice
  // (§70.1/§13). A mixed domain still commits the shown level to normalise.
  if(r===rank&&!mixed&&!draining.current&&desired.current==null){setPending(null);return;}
  setPending(r);desired.current=r;void drain();
 },[maxRank,rank,mixed,drain]);
 const key=e=>{if(disabled)return;let r=shown;
  if(e.key==='ArrowRight'||e.key==='ArrowUp')r=shown+1;else if(e.key==='ArrowLeft'||e.key==='ArrowDown')r=shown-1;
  else if(e.key==='Home')r=0;else if(e.key==='End')r=maxRank;
  // Enter/Space commit the DISPLAYED value. On a mixed domain this normalises every underlying tool to
  // the shown level (commit bypasses the equality no-op when mixed) — giving keyboard users the same
  // normalise-to-current action pointer users get from a click, which the arrow/Home/End keys cannot
  // express (they all move AWAY from the displayed value). On a settled knob it is a harmless no-op.
  else if(e.key==='Enter'||e.key===' '||e.key==='Spacebar')r=shown;
  else return;e.preventDefault();commit(r);};
 const S=React.useRef({});
 const down=e=>{if(disabled)return;S.current={x:e.clientX,r:shown};
  try{e.currentTarget.setPointerCapture(e.pointerId);}catch(_){/* setPointerCapture can throw in some browsers/jsdom; drag still works without capture */}
  e.preventDefault();};
 const move=e=>{if(disabled||S.current.x==null)return;const d=Math.round((e.clientX-S.current.x)/26);const r=Math.max(0,Math.min(maxRank,S.current.r+d));if(r!==shown)setPending(r);};
 const up=()=>{if(disabled||S.current.x==null)return;const r=pending!=null?pending:shown;S.current={};commit(r);};
 // A cancelled gesture (pointercancel — an interrupted touch/pen) is NOT a release: discard the
 // provisional drag and restore the last committed value rather than persisting a change the user
 // never completed (a governance write must reflect a deliberate choice, §70.1).
 const cancel=()=>{if(S.current.x==null)return;S.current={};setPending(null);};
 const frac=maxRank>0?shown/2:0; // arc position 0..1 across off→confirm→auto
 // brushed dial
 const W=64,cx=32,cy=32,Rk=20,a0=Math.PI*0.75,a1=Math.PI*2.25;
 const pt=(r,a)=>[cx+Math.cos(a)*r,cy+Math.sin(a)*r];
 const ind=pt(Rk-3,a0+(a1-a0)*frac),indb=pt(Rk-12,a0+(a1-a0)*frac);
 return <span role="slider" tabIndex={disabled?-1:0} aria-label={ariaLabel}
  aria-valuemin={0} aria-valuemax={maxRank} aria-valuenow={shown} aria-valuetext={MODE_LABEL[modeOfRank(shown)]}
  aria-disabled={disabled?'true':undefined}
  onKeyDown={key} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}
  style={{display:'inline-flex',width:W,height:W,flex:'none',cursor:disabled?'not-allowed':'ew-resize',borderRadius:'50%',touchAction:'none',opacity:disabled?.75:1,outlineOffset:3}}>
  <svg width={W} height={W} viewBox={'0 0 '+W+' '+W} aria-hidden="true">
   {[0,1,2].map(i=>{const a=a0+(a1-a0)*(i/2);const o=pt(Rk+5,a),n=pt(Rk+2,a);
    return <line key={i} x1={o[0]} y1={o[1]} x2={n[0]} y2={n[1]} stroke="var(--ink-3)" strokeOpacity=".5" strokeWidth="1.4"/>;})}
   <circle cx={cx} cy={cy} r={Rk} fill="var(--surface-sunk)" stroke="var(--line)" strokeWidth="1.4"/>
   <circle cx={cx} cy={cy} r={Rk-4} fill="var(--surface)" stroke="var(--line-soft)" strokeWidth="1"/>
   {!disabled&&<line x1={indb[0]} y1={indb[1]} x2={ind[0]} y2={ind[1]} stroke={modeCol(modeOfRank(shown))} strokeWidth="2.6" strokeLinecap="round"/>}
   <circle cx={cx} cy={cy} r="2.4" fill={disabled?'var(--ink-3)':modeCol(modeOfRank(shown))}/>
  </svg>
  {saving&&<span style={{position:'absolute',width:1,height:1,overflow:'hidden'}} role="status">Saving…</span>}
 </span>;
};

// ── the central compass: overall posture as a needle + an honest reasoning line ──────────────
const BEARINGS=['guardrails','asks','held','your_call','not_ready'];
function overallPosture(domains){if(!domains.length)return 'not_ready';
 // most-common domain posture; ties resolve to the more restrictive (never overstate trust)
 const pref=['not_ready','your_call','held','asks','guardrails'];
 const c={};domains.forEach(d=>{c[d.posture]=(c[d.posture]||0)+1;});
 let best='asks',bn=-1;pref.forEach(k=>{const n=c[k]||0;if(n>bn){bn=n;best=k;}});return best;}
function overallReason(domains){
 const c={guardrails:0,asks:0,held:0,your_call:0};
 domains.forEach(d=>{if(c[d.posture]!=null)c[d.posture]+=1;});
 const parts=[];
 if(c.guardrails)parts.push(c.guardrails+' acting within guardrails');
 if(c.asks)parts.push(c.asks+' asking first');
 if(c.held)parts.push(c.held+' held');
 if(c.your_call)parts.push(c.your_call+' your call');
 return parts.length?parts.join(' · '):'nothing set up yet';}
const TcCompass=({domains,reduced})=>{
 const overall=domains.length?overallPosture(domains):'not_ready';
 const oi=Math.max(0,BEARINGS.indexOf(overall));
 const W=300,cx=150,cy=150,R=118;
 const P=POSTURE_META[overall];
 const bearingPt=(i,r)=>{const a=-Math.PI/2+i/5*Math.PI*2;return [cx+Math.cos(a)*r,cy+Math.sin(a)*r];};
 return <div className="compasscol" style={{display:'flex',flexDirection:'column',alignItems:'center',gap:10}}>
  <div style={{position:'relative',width:'100%',maxWidth:320,display:'grid',placeItems:'center'}}>
   <svg width="100%" viewBox={'0 0 '+W+' '+W} role="img"
    aria-label={'Overall, Paige is '+P.label.toLowerCase()+' across your capabilities: '+overallReason(domains)+'. This is a summary of your per-capability settings and platform policy, not a control.'}
    style={{maxWidth:320,display:'block'}}>
    <circle cx={cx} cy={cy} r={R+8} fill="none" stroke="var(--line)" strokeWidth="1"/>
    <circle cx={cx} cy={cy} r={R} fill="var(--surface-2)" stroke="var(--line-soft)" strokeWidth="1.4"/>
    {BEARINGS.map((k,i)=>{const on=k===overall;const m=bearingPt(i,R-2);const mk=POSTURE_META[k];
     return <circle key={k} cx={m[0]} cy={m[1]} r={on?6:3.4} fill={mk.col} fillOpacity={on?1:.5}
      stroke={on?'var(--surface)':undefined} strokeWidth={on?1.4:undefined}/>;})}
    <g style={{transformBox:'view-box',transformOrigin:cx+'px '+cy+'px',transform:'rotate('+(oi/5*360)+'deg)',transition:reduced?'none':'transform .9s cubic-bezier(.32,.72,0,1)'}}>
     <path d={'M'+cx+' '+(cy-R+18)+' L'+(cx+6)+' '+cy+' L'+cx+' '+(cy+38)+' L'+(cx-6)+' '+cy+' Z'} fill="var(--gold-bright)"/>
    </g>
    <circle cx={cx} cy={cy} r="34" fill="var(--surface)" stroke="var(--line)" strokeWidth="1.4"/>
   </svg>
   <div style={{position:'absolute',textAlign:'center',pointerEvents:'none',maxWidth:120}}>
    <div className="eyebrow" style={{fontSize:8.5,color:'var(--ink-3)'}}>Overall</div>
    <div style={{fontSize:13.5,fontWeight:700,color:P.col,lineHeight:1.15,marginTop:2}}>{P.label}</div>
    <div className="mono" style={{fontSize:8,letterSpacing:'.1em',textTransform:'uppercase',color:'var(--ink-3)',marginTop:3}}>Read-only</div>
   </div>
  </div>
  <div className="row" role="note" style={{gap:7,justifyContent:'center',flexWrap:'wrap',fontSize:12,color:'var(--ink-2)',textAlign:'center',maxWidth:360,lineHeight:1.5}}>
   <span style={{color:P.col,display:'flex'}}><Ic.shield size={13}/></span>
   <span>Pointing to <strong style={{color:P.col}}>{P.label}</strong> — {overallReason(domains)}.</span>
  </div>
  <div className="sub" style={{fontSize:10.4,fontStyle:'italic',textAlign:'center',maxWidth:340}}>Read from your enforced settings and platform policy — never a score.</div>
  <div className="row" style={{gap:'6px 12px',flexWrap:'wrap',justifyContent:'center',maxWidth:360}}>
   {BEARINGS.filter(k=>k!=='not_ready').map(k=>{const on=k===overall;const mk=POSTURE_META[k];
    return <span key={k} className="row" style={{gap:5,fontSize:10.3,color:on?mk.col:'var(--ink-2)',fontWeight:on?700:400,opacity:on?1:.65}}>
     <span style={{width:8,height:8,borderRadius:'50%',background:mk.col}}/>{mk.label}</span>;})}
  </div>
 </div>;
};

export const MiniCompass=({dept,label='This action was drafted because the platform default for',compact=false})=>{
const{depts,loading,configured}=useTrustDepartments();
const d=depts.find(x=>x.n===dept||x.id===dept);
// An absent read is reported as absent. It is never rendered as a level, because "no posture" and
// "she never acts here" are different statements and only one of them is true.
if(loading)return <div className="sub" style={{fontSize:12.2,padding:'10px 12px'}} role="status">Reading the platform default…</div>;
if(!configured||!d)return <div className="sub" style={{fontSize:12.2,padding:'10px 12px'}} role="status">The platform default for this department is unavailable.</div>;
const g=d.g;const t=tierOfLevel(g);
if(t==null)return <div style={{border:'1px solid var(--line)',borderRadius:'var(--r-m)',padding:compact?'10px 12px':'12px 14px',background:'var(--surface-2)'}}>
<span style={{fontSize:12.4,color:'var(--ink-2)'}}>No action types are routed to <strong style={{color:'var(--ink)'}}>{d.n}</strong> yet, so there is no default to show.</span></div>;
const col=t==='green'?'var(--ok)':t==='amber'?'var(--warn)':'var(--bad)';
const tint=t==='green'?'var(--ok-tint)':t==='amber'?'var(--warn-tint)':'var(--bad-tint)';
return <div style={{border:'1px solid var(--line)',borderRadius:'var(--r-m)',padding:compact?'10px 12px':'12px 14px',background:'var(--surface-2)'}}>
<div className="row" style={{gap:8,flexWrap:'wrap'}}>
<span style={{fontSize:12.4,color:'var(--ink-2)'}}>{label} <strong style={{color:'var(--ink)'}}>{d.n}</strong> is <strong style={{color:col}}>{tierLabel[t].toLowerCase()}</strong>.</span>
<span className="pill" style={{marginLeft:'auto',background:tint,color:col}}>{tierLabel[t]}</span></div>
<div style={{position:'relative',marginTop:11,height:22,display:'flex',alignItems:'center'}} role="img"
 aria-label={d.n+' platform default: '+d.w[0]+' run automatically, '+d.w[1]+' drafted for you, '+d.w[2]+' always your call'}>
<div style={{position:'absolute',inset:'8px 0',borderRadius:99,overflow:'hidden',display:'flex'}}>
<span style={{width:(g*100)+'%',background:'var(--ok)',opacity:.5}}/>
<span style={{width:(TC_AMBER*100)+'%',background:'var(--warn)',opacity:.5}}/>
<span style={{flex:1,background:'var(--bad)',opacity:.42}}/></div></div>
<div className="row" style={{justifyContent:'space-between',marginTop:2}}>
<span className="sub" style={{fontSize:10.5}}>{d.w[0]} run automatically</span>
<span className="sub" style={{fontSize:10.5}}>{d.w[1]} drafted · {d.w[2]} your call</span></div>
<div className="sub" style={{fontSize:10.5,marginTop:6}}>Platform default policy — not a setting this workspace chose.</div></div>};

// ── one capability knob card (real per-tool governance via set_tool_autonomy) ─────────────────
// `readOnly` (non-admin viewer): the server refuses set_tool_autonomy for non-admins, so we render
// the real posture as a STATIC pill, never an active slider that only fails on write (§70.1).
const KnobCard=({domain,open,onToggle,onSetDomain,onSetTool,onError,readOnly,side})=>{
 const P=POSTURE_META[domain.posture];
 const settable=domain.tools.filter(t=>t.settable);
 const ariaLabel='How much '+domain.title+' may run on its own';
 return <div className={'card'} data-cap={domain.key} style={{overflow:'hidden'}}>
  <div className="row" style={{gap:11,padding:'12px 14px',alignItems:'center'}}>
   <button onClick={onToggle} aria-expanded={open?'true':'false'} aria-controls={'cap-'+domain.key}
    className="row grow" style={{gap:11,minWidth:0,textAlign:'left',background:'transparent'}}>
    <span className="tile" style={{width:34,height:34,borderRadius:'50%',background:'var(--violet-tint)',color:'var(--violet)',flex:'none'}}>{React.createElement(Ic[domain.icon]||Ic.grid,{size:17})}</span>
    <span style={{minWidth:0}}>
     <span style={{fontSize:13.4,fontWeight:700,color:'var(--ink)',display:'block',lineHeight:1.15}}>{domain.title}</span>
     <span style={{fontSize:13,fontWeight:500,color:P.col,display:'block',marginTop:1}}>{P.label}</span></span>
   </button>
   {settable.length
    ? <TcKnob value={domain.level} max={domain.domainMax} mixed={domain.mixed} ariaLabel={ariaLabel} onError={onError}
       onCommit={(m)=>onSetDomain(domain.key,m)}/>
    : readOnly
     ? <span className={'pill '+P.pill} style={{flex:'none'}} title="Read-only — a workspace admin can change this">{P.label}</span>
     : <span className="pill pill-n" style={{flex:'none'}}>Your call</span>}
  </div>
  {settable.length>0&&<div className="row" style={{gap:6,padding:'0 15px 10px',fontSize:10.3,color:'var(--ink-3)'}}>
   <Ic.arrow size={11} style={{color:'var(--violet)',flex:'none'}}/>Drag or use ← → to set.</div>}
  <div className="row" style={{justifyContent:'space-between',gap:10,padding:'0 15px 12px',alignItems:'center'}}>
   <span className="sub" style={{fontSize:11}}>{domain.blurb}</span>
   <span className={'pill '+P.pill}>{P.label}</span>
  </div>
  {domain.heldBackNote&&<div className="row" style={{gap:6,padding:'0 15px 12px',fontSize:10.6,color:'var(--ink-3)',alignItems:'flex-start'}}>
   <Ic.shield size={12} style={{flex:'none',marginTop:1}}/><span>{domain.heldBackNote}</span></div>}
  {open&&<div id={'cap-'+domain.key} className="fade-in" style={{borderTop:'1px solid var(--line-soft)',padding:'8px 0 4px'}}>
   {domain.tools.map((t,i)=>{const tp=POSTURE_META[t.risk==='owner_only'?'your_call':t.effective==='auto'?'guardrails':t.effective==='confirm'?'asks':'held'];
    return <div key={t.toolKey} className="row" style={{gap:10,padding:'9px 15px',borderTop:i?'1px solid var(--line-soft)':'0',alignItems:'center'}}>
     <span className="grow" style={{minWidth:0}}>
      <span className="trunc" style={{fontSize:12.6,fontWeight:500,color:'var(--ink)',display:'block'}}>{t.label}</span>
      {t.heldBack&&<span className="sub" style={{fontSize:10.4,display:'block',marginTop:1}}>{t.heldBack.reason}</span>}
      {!t.heldBack&&t.isDefault&&<span className="sub" style={{fontSize:10.4,display:'block',marginTop:1}}>Platform default</span>}
     </span>
     {t.settable
      ? <TcKnob value={clampModeToRisk(t.stored,t.risk)} max={maxModeForRisk(t.risk)} ariaLabel={'How much “'+t.label+'” may run on its own'} onError={onError}
         onCommit={(m)=>onSetTool(t.toolKey,m)}/>
      : t.risk==='owner_only'
       ? <span className="pill pill-n" title="Owner-only — always your call" style={{flex:'none'}}>Your call</span>
       : null /* read-only (non-admin): the effective-posture label at right already shows the real state */}
     <span style={{fontSize:11,fontWeight:600,color:tp.col,minWidth:96,textAlign:'right'}}>{tp.label}</span>
    </div>;})}
  </div>}
 </div>;
};

// Shared shell so the modals cannot drift apart in how they report an absent read (§18).
const TcModalState=({state,error,onRetry,emptyLine})=>
 <div className="sub" style={{fontSize:12.9,lineHeight:1.55,padding:'4px 2px'}} role={state==='error'?'alert':'status'}>
 {state==='loading'?'Reading what is waiting on you…'
  :state==='error'?<>This could not be loaded, so it is not a record of nothing waiting.{error?' ('+error+')':''} <button className="btn btn-s" style={{marginTop:9}} onClick={onRetry}>Try again</button></>
  :emptyLine}</div>;

const TcDept=({id,onBack})=>{
const{depts,loading,configured}=useTrustDepartments();
const d=depts.find(x=>x.id===id);
if(loading)return <div className="sub" style={{padding:'18px 4px'}} role="status">Reading the platform default policy…</div>;
if(!configured||!d)return <div className="fade-in card" style={{padding:'18px 20px'}}>
 <div className="row" style={{gap:13}}><button className="btn btn-s" onClick={onBack}><span style={{transform:'rotate(180deg)',display:'flex'}}><Ic.arrow size={13}/></span>Full compass</button></div>
 <div className="sub" style={{marginTop:12}} role="status">This department's default policy could not be read, so nothing is shown for it. That is not a record of it having no policy.</div></div>;
const t=tierOfLevel(d.g);
const laneCopy={auto:'Runs automatically',confirm:'Drafts for you',off:'Always your call'};
const laneCol={auto:'var(--ok)',confirm:'var(--warn)',off:'var(--bad)'};
return <div className="fade-in" style={{display:'grid',gap:16}}>
<div className="card" style={{padding:'16px 20px'}}>
<div className="row" style={{gap:13,flexWrap:'wrap'}}>
<button className="btn btn-s" onClick={onBack}><span style={{transform:'rotate(180deg)',display:'flex'}}><Ic.arrow size={13}/></span>Full compass</button>
<span className="tile" style={{background:'var(--violet-tint)',color:'var(--violet)'}}>{React.createElement(Ic[d.ic]||Ic.grid,{size:16})}</span>
<div className="grow" style={{minWidth:200}}><div style={{fontWeight:600,fontSize:16,letterSpacing:'-.02em'}}>{d.n}</div>
<div className="sub">{d.w[0]} run automatically · {d.w[1]} drafted for you · {d.w[2]} always your call</div></div>
{t&&<span className="pill" style={{background:t==='green'?'var(--ok-tint)':t==='amber'?'var(--warn-tint)':'var(--bad-tint)',
 color:t==='green'?'var(--ok)':t==='amber'?'var(--warn)':'var(--bad)'}}>{tierLabel[t]}</span>}</div>
<div className="sub" style={{fontSize:10.8,marginTop:9}}>Platform default policy — not a setting this workspace chose. There is no per-workspace autonomy record to show.</div></div>
<div className="card"><div className="hd"><div><h3>Action types routed here</h3>
<div className="sub">{d.acts.length?'Each one runs in the lane the platform sets for it.':'Nothing is routed to this department yet.'}</div></div></div>
<div style={{padding:'6px 0 4px'}}>{d.acts.map((a,i)=>
<div key={a.label} className="row" style={{gap:11,padding:'11px 20px',borderTop:i?'1px solid var(--line-soft)':'0'}}>
<span style={{width:7,height:7,borderRadius:'50%',flex:'none',background:laneCol[a.lane]}}/>
<span className="grow trunc" style={{fontSize:13.1,fontWeight:500}}>{a.label}</span>
<span style={{fontSize:11.5,fontWeight:600,color:laneCol[a.lane]}}>{laneCopy[a.lane]}</span></div>)}
{!d.acts.length&&<div className="sub" style={{padding:'12px 20px'}}>No enabled action types are routed to this department, so it has no default policy to show.</div>}</div></div></div>};

export const TrustCompass=({accountEpoch,openPaige}={})=>{
const reduced=useReduced();
const gov=useSoloToolGovernance(accountEpoch);
// The active workspace, plumbed in as `accountEpoch`, re-keys every read on a switch and
// invalidates anything in flight, so no previous workspace's row survives even for a frame.
const activity=useSoloActivityFeed(accountEpoch);
const pending=useSoloPendingActions(accountEpoch??null); // §9 — scope the pending read to the VIEWED workspace
const{depts,configured:trustConfigured}=useTrustDepartments(accountEpoch);
const[open,setOpen]=React.useState(null);
const[full,setFull]=React.useState(null);
const[fold,setFold]=React.useState(null);
const[toast,setToast]=React.useState(null);
const toastMsg=React.useCallback(m=>{setToast(m);setTimeout(()=>setToast(null),3200)},[]);
const onError=React.useCallback(err=>{
 // A non-admin's write is refused uniformly (all-or-nothing), so "not changed" is accurate there. A
 // transient failure on a domain (bulk) write may be partial, so the generic message does NOT claim
 // nothing changed — the hook has already re-read the real state, which the knob now reflects (§13).
 const m=/AUTONOMY_FORBIDDEN|forbidden|42501|admin/i.test(String(err||''))
  ? "That change needs an admin on this workspace — your setting was not changed."
  : "That didn't fully save — I've re-read your current settings.";
 toastMsg(m);
},[toastMsg]);
const setDomain=React.useCallback((k,m)=>gov.setDomainMode(k,m),[gov]);
const setTool=React.useCallback((t,m)=>gov.setToolMode(t,m),[gov]);
const goPaige=React.useCallback(()=>{if(typeof openPaige==='function')openPaige();else toastMsg('Open Paige from the sidebar to make this decision.');},[openPaige,toastMsg]);

const live=React.useMemo(()=>activity.items.map(a=>({
 id:a.id,t:a.title,dept:departmentLabel(a.departmentSlug),by:a.byPaige?'Paige':a.actorAgent?a.actorAgent:a.byPerson?'Person':'Unattributed',w:elapsedLabel(a.occurredAt)})),[activity.items]);
const liveState=activity.loading?'loading':activity.error?'error':live.length?'ok':'empty';

if(full)return <Wrap><PageHead eyebrow="Platform · Trust Compass" title={depts.find(d=>d.id===full)?.n||"Department"} sub="Every action type routed here, and the lane the platform default puts it in."/>
<TcDept id={full} onBack={()=>setFull(null)}/></Wrap>;

const domains=gov.domains;
const left=domains.slice(0,3),right=domains.slice(3);

return <div className="fade-in pg" style={{width:'100%',maxWidth:1440,margin:'0 auto'}}>
{/* §66 title rule: the surface title stays in the DOM for assistive tech but not as a banner. */}
<h1 style={{position:'absolute',width:1,height:1,overflow:'hidden',clipPath:'inset(50%)'}}>Trust Compass</h1>
<div className="pg-hd" style={{padding:'12px clamp(16px,2.6vw,40px) 8px'}}>
 <p className="pg-sub" style={{color:'var(--ink-2)',fontSize:13.2,maxWidth:640,lineHeight:1.4}}>Set what Paige may do on her own, see what needs your approval, and what the platform still limits.</p>
</div>

<div className="pg-body">
 {/* ── the governed instrument — gated on the governance read; the sections below are
        independent honest reads and render whatever the governance read is doing. ── */}
 {gov.loading?
  <div className="card" style={{padding:'22px 20px'}} role="status"><div className="sub">Reading what this workspace lets Paige do…</div>
   <div style={{display:'grid',gap:10,marginTop:14}}>{[0,1,2].map(i=><div key={i} style={{height:52,borderRadius:'var(--r-m)',background:'var(--surface-sunk)'}}/>)}</div></div>
 :!gov.configured?
  <div className="card"><div className="state" style={{padding:'26px 20px',display:'grid',gap:8}} role={gov.error?'alert':'status'}>
   <div style={{fontSize:14,fontWeight:600,color:'var(--ink)'}}>What Paige is allowed to do couldn't be read for this workspace.</div>
   <div className="sub" style={{maxWidth:'56ch',lineHeight:1.5}}>{gov.error?'The permissions read failed, so nothing is shown — not a record of an empty or open workspace.':'Nothing is set up here yet.'} If this persists it is a read/permissions issue, not a setup step.</div>
   <button className="btn btn-s" style={{marginTop:4}} onClick={gov.refresh}>Try again</button></div></div>
 :<>
  {gov.ceilingLimiting&&<div className="card" role="note" style={{padding:'11px 15px',display:'flex',gap:9,alignItems:'center'}}>
   <Ic.shield size={15} style={{color:'var(--violet)',flex:'none'}}/><span className="sub" style={{fontSize:12}}>Platform policy is currently limiting some unattended actions further, on top of your settings.</span></div>}
  {gov.ceilingUnconfirmed&&<div className="card" role="status" style={{padding:'11px 15px',display:'flex',gap:9,alignItems:'center'}}>
   <Ic.shield size={15} style={{color:'var(--warn)',flex:'none'}}/><span className="sub" style={{fontSize:12}}>Platform limits couldn’t be confirmed just now, so what’s shown may be more permissive than policy actually allows. Your own settings are unaffected.</span></div>}
  {!gov.canWrite&&(gov.authorityUnconfirmed
   ? <div className="card" role="status" style={{padding:'11px 15px',display:'flex',gap:9,alignItems:'center'}}>
      <Ic.shield size={15} style={{color:'var(--warn)',flex:'none'}}/><span className="sub" style={{fontSize:12}}>We couldn’t confirm your access just now, so editing is disabled — this is not a record that you lack it.</span>
      <button className="btn btn-s" style={{marginLeft:'auto',flex:'none'}} onClick={gov.refresh}>Try again</button></div>
   : <div className="card" role="note" style={{padding:'11px 15px',display:'flex',gap:9,alignItems:'center'}}>
      <Ic.shield size={15} style={{color:'var(--ink-3)',flex:'none'}}/><span className="sub" style={{fontSize:12}}>You have read-only access here. A workspace admin can change what Paige may do on her own.</span></div>)}
  <div className="tc2-instrument" style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1.15fr) minmax(0,1fr)',gap:16,alignItems:'start'}}>
   <div style={{display:'grid',gap:14}}>{left.map(d=><KnobCard key={d.key} domain={d} open={open===d.key} onToggle={()=>setOpen(open===d.key?null:d.key)} onSetDomain={setDomain} onSetTool={setTool} onError={onError} readOnly={!gov.canWrite} side="lft"/>)}</div>
   <TcCompass domains={domains} reduced={reduced}/>
   <div style={{display:'grid',gap:14}}>{right.map(d=><KnobCard key={d.key} domain={d} open={open===d.key} onToggle={()=>setOpen(open===d.key?null:d.key)} onSetDomain={setDomain} onSetTool={setTool} onError={onError} readOnly={!gov.canWrite} side="rgt"/>)}</div>
  </div>
 </>}

 {/* Pending decisions — a REAL read of paige_actions; the decision itself is made in the one Paige chat. */}
 <div className="card">
  <div className="hd"><div><h3>Waiting on your decision</h3>
   <div className="sub">{pending.loading?'Reading what is waiting on you…':pending.error?'This could not be read just now.':pending.items.length?'Work Paige has prepared but will not take without you.':'Nothing is waiting on your decision right now.'}</div></div>
   <span className={'pill '+(pending.items.length?'pill-warn':'pill-n')}>{pending.loading?'…':pending.error?'Unavailable':pending.items.length?pending.items.length+' waiting':'Clear'}</span></div>
  {pending.error
   ? <div className="sub" role="alert" style={{padding:'14px 20px'}}>This could not be read, so it is not a record of nothing waiting. <button className="btn btn-s" style={{marginLeft:8}} onClick={pending.refresh}>Try again</button></div>
   : pending.items.slice(0,4).map((a,i)=>
   <div key={a.id} className="row" style={{gap:11,padding:'11px 20px',borderTop:i?'1px solid var(--line-soft)':'0',alignItems:'flex-start'}}>
    <span style={{width:7,height:7,borderRadius:'50%',flex:'none',marginTop:5,background:'var(--warn)'}}/>
    <span className="grow" style={{minWidth:0}}><span style={{fontSize:12.9,color:'var(--ink)',lineHeight:1.4,display:'block'}}>{a.title}</span>
     <span className="sub" style={{fontSize:11.2}}>{a.department} · waiting on your decision</span></span>
    <button className="btn btn-s" onClick={goPaige} style={{flex:'none'}}>Decide in Paige <Ic.arrow size={12}/></button></div>)}
  {!pending.loading&&!pending.error&&pending.items.length===0&&<div className="sub" style={{padding:'8px 20px 14px'}}>When Paige prepares work she is not allowed to run alone, it appears here — and you decide it in the Paige chat.</div>}
 </div>

 {/* Recorded work — real Rail (get_solo_rail_activity), honest 4-state; a recorded person (owner_staff) → Person (E4-S3), unknown actor → Unattributed. */}
 <div className="card">
  <div className="hd"><div><h3>What's been recorded</h3><div className="sub">Work that has actually happened and been logged.</div></div>
   <span className={'pill '+(liveState==='ok'?'pill-ok':'pill-n')}>{liveState==='ok'?<><span className="dot"/>Recorded</>:liveState==='loading'?'Loading':liveState==='error'?'Unavailable':'Nothing yet'}</span></div>
  <div className="pane">{liveState!=='ok'
   ? <div className="sub" role={liveState==='error'?'alert':'status'} style={{padding:'16px 20px',fontSize:12.4,lineHeight:1.5}}>{liveState==='loading'?'Reading what she has done…':liveState==='error'?<>Recent activity could not be loaded, so this is not a record of nothing happening. <button className="btn btn-s" style={{marginLeft:8}} onClick={activity.refresh}>Try again</button></>:'Nothing recorded yet. Anything Paige or your team does lands here as it happens.'}</div>
   : live.map((l,i)=>
    <div key={l.id} className="row" style={{gap:11,padding:'11px 20px',borderTop:i?'1px solid var(--line-soft)':'0',alignItems:'flex-start'}}>
     <span style={{width:7,height:7,borderRadius:'50%',flex:'none',marginTop:5,background:'var(--ok)'}}/>
     <span className="grow" style={{minWidth:0}}><span style={{fontSize:12.9,color:'var(--ink-2)',lineHeight:1.45,display:'block'}}>{l.t}</span>
      <span className="sub" style={{fontSize:11.3}}>{l.dept} · {l.by} · performed and logged</span></span>
     <span className="mono sub" style={{fontSize:10.8,flex:'none'}}>{l.w}</span></div>)}</div>
 </div>

 <div className="row" style={{gap:9,flexWrap:'wrap'}}>
  <button className="btn btn-s grow" style={{justifyContent:'center'}} onClick={()=>setFold('depts')}><Ic.grid size={14}/>Platform defaults by department</button>
  <button className="btn btn-s grow" style={{justifyContent:'center'}} onClick={goPaige}><Ic.spark size={14}/>Ask Paige about a capability</button>
 </div>

 {/* Honest incompletes — shown, never simulated (§4.3/§32). */}
 <div style={{border:'1px dashed var(--line)',borderRadius:'var(--r-l)',background:'var(--surface-2)',padding:'14px 18px',display:'grid',gap:9}}>
  <div className="eyebrow" style={{fontSize:11,color:'var(--ink-2)'}}>Still incomplete — shown honestly, never simulated</div>
  {[['users','Per-agent accountability','The record can show Paige’s team acted, but not always which specialist did — the log doesn’t carry that yet. Where it’s missing it reads Unattributed, never a guessed name.'],
    ['bolt','Connected-worker status','Texting and automation tools report their live status into this view in a later release; until then their capabilities read from the platform default.'],
    ['shield','Platform ceiling detail','You see the effect of platform policy on your own tools, never the platform posture itself — that stays with the operator.']].map((r,i)=>
   <div key={i} className="row" style={{gap:9,alignItems:'flex-start',fontSize:11.6,color:'var(--ink-2)',lineHeight:1.45}}>
    <span style={{color:'var(--ink-3)',flex:'none',marginTop:1}}>{React.createElement(Ic[r[0]]||Ic.grid,{size:15})}</span>
    <span><strong style={{color:'var(--ink)'}}>{r[1]}.</strong> {r[2]}</span></div>)}
 </div>

 <div className="sub" style={{textAlign:'center',fontSize:11,padding:'2px 0 12px',color:'var(--ink-3)'}}>Trust is shown from your enforced settings and recorded evidence.</div>
</div>

<Foldout open={fold==='depts'} onClose={()=>setFold(null)} wide title="Platform defaults by department" sub="Read-only. The lane the platform sets for each department's action types — the same for every workspace, not a setting this workspace chose.">
 <div>{!trustConfigured?<div className="sub" role="status" style={{padding:'16px 20px'}}>The platform default policy is unavailable right now.</div>
  :depts.map((d,i)=>{const t=tierOfLevel(d.g);
   return <button key={d.id} onClick={()=>{setFold(null);setFull(d.id);}} className="row"
    style={{width:'100%',textAlign:'left',gap:11,padding:'10px 20px',borderTop:i?'1px solid var(--line-soft)':'0'}}>
    <span style={{width:7,height:7,borderRadius:'50%',flex:'none',background:t==='green'?'var(--ok)':t==='amber'?'var(--warn)':t==='red'?'var(--bad)':'var(--ink-3)'}}/>
    <span className="grow trunc" style={{fontSize:12.9,fontWeight:500}}>{d.n}</span>
    <span className="mono sub" style={{fontSize:11}}>{d.w[0]}/{d.w[1]}/{d.w[2]}</span>
    <span className="pill pill-n" style={{fontSize:10}}>{t?tierLabel[t]:'No default set'}</span></button>;})}</div></Foldout>

{toast&&<div className="fade-in row" role="status" style={{position:'fixed',bottom:26,left:'50%',transform:'translateX(-50%)',gap:9,background:'var(--rail)',color:'var(--ink-inv)',
padding:'11px 18px',borderRadius:12,fontSize:13,boxShadow:'var(--sh-3)',zIndex:95,maxWidth:'min(560px,92vw)'}}>
<span style={{color:'var(--gold-bright)',display:'flex',flex:'none'}}><Ic.check size={15}/></span>{toast}</div>}
</div>;};
