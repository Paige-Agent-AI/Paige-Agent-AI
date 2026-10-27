import {useRef} from "react";
import {useTheme} from "next-themes";
import {ArrowLeft,ClipboardCheck,Clock3,RefreshCw,ShieldCheck} from "lucide-react";
import {Dialog,DialogClose,DialogContent,DialogDescription,DialogTitle} from "@/components/ui/dialog";
import type {RecordedRunRead} from "@/hooks/useSystemsCheck";
import "./systems-check-run-review.css";

const dateFormat=new Intl.DateTimeFormat(undefined,{year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"});
const numberFormat=new Intl.NumberFormat();

/** Original recorded source only. Counts never verify a Rail receipt, an action,
 * current health or worker liveness. All authority remains in the existing read. */
export function SystemsCheckRunReview({open,record,onClose,onRefresh,onReturnFocus}:{
 open:boolean;record:RecordedRunRead;onClose:()=>void;onRefresh:()=>void;onReturnFocus:(previous:HTMLElement|null)=>void;
}){
 const {resolvedTheme}=useTheme();
 const heading=useRef<HTMLHeadingElement>(null);
 const returnFocus=useRef<{target:HTMLElement|null;restore:typeof onReturnFocus}|null>(null);
 const run=record.state==="ready"?record.run:null;
 const completed=!!run?.completed_at;
 const figures=run?[run.check_count,run.pass_count,run.fail_count]:[];
 const unknown=figures.some(value=>value===null);
 const zero=figures.length===3&&figures.every(value=>value===0);
 return <Dialog open={open} onOpenChange={next=>{if(!next)onClose();}}>
  <DialogContent className="sc-record-review" data-pg={resolvedTheme==="dark"?"dark":"light"}
   onOpenAutoFocus={event=>{event.preventDefault();returnFocus.current={target:document.activeElement instanceof HTMLElement?document.activeElement:null,restore:onReturnFocus};heading.current?.focus({preventScroll:true});}}
   onCloseAutoFocus={event=>{event.preventDefault();const saved=returnFocus.current;returnFocus.current=null;if(saved)requestAnimationFrame(()=>saved.restore(saved.target));}}>
   <header><p className="sc-record-eyebrow"><ClipboardCheck size={16} aria-hidden="true"/>Systems Check</p>
    <DialogTitle ref={heading} tabIndex={-1} className="sc-record-title">{run?completed?"Recorded check":"Started check":"Original check"}</DialogTitle>
    <DialogDescription className="sr-only">The original recorded result. Reading it starts no new check.</DialogDescription>
   </header>
   {record.state==="loading"?<section className="sc-record-state" role="status"><RefreshCw size={24} aria-hidden="true"/><h3>Reading the recorded check…</h3><p>Waiting for the original source.</p></section>
    :record.state==="error"?<section className="sc-record-state" role="alert"><h3>The record could not be read.</h3><p>Your business view is still here. Try reading it again.</p><button type="button" className="sc-record-action" onClick={onRefresh}><RefreshCw size={17} aria-hidden="true"/>Read again</button></section>
     :!run?<section className="sc-record-state" role="status"><ShieldCheck size={24} aria-hidden="true"/><h3>This check is unavailable in this workspace.</h3><p>Its result and supporting information have not been returned.</p></section>
      :<><div className="sc-record-date"><Clock3 size={19} aria-hidden="true"/><div><span>{completed?"Completed":"Started"}</span><strong><time dateTime={run.completed_at??run.started_at}>{dateFormat.format(new Date(run.completed_at??run.started_at))}</time></strong></div><span className="sc-record-label">{completed?"Recorded result":"No completed result"}</span></div>
       {completed?<><span role="status" className="sr-only">Original check record loaded.</span><dl className="sc-record-counts">{["Checks recorded","Passed","Failed"].map((label,index)=><div key={label}><dt>{label}</dt><dd>{figures[index]===null?"—":numberFormat.format(figures[index]!)}</dd></div>)}</dl>
        <p className="sc-record-note">{unknown?"Some original counts are unavailable. They remain unknown.":zero?"Zero recorded checks do not establish business readiness.":"These totals describe this recorded check. Current readiness is shown in the workspace."}</p></>
        :<section className="sc-record-state" role="status"><h3>No completed result was recorded.</h3><p>Current progress is unconfirmed.</p></section>}
       <section className="sc-record-source"><h3>Original source</h3><p>Systems Check record · Your workspace</p>{completed&&<p>Started <time dateTime={run.started_at}>{dateFormat.format(new Date(run.started_at))}</time></p>}</section></>}
   <footer className="sc-record-footer"><DialogClose asChild><button type="button" className="sc-record-action"><ArrowLeft size={17} aria-hidden="true"/>Return to Systems Check</button></DialogClose><span>Read only</span></footer>
  </DialogContent>
 </Dialog>;
}
