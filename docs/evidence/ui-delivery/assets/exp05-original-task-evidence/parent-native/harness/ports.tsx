import {createContext,useContext,useState} from 'react';
export const FixtureContext=createContext({mode:'verified',scope:'A'});
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const updatedAt='2026-10-27T12:00:00Z';
const item={approvalId:id(2),occurrenceId:id(3),approvalStatus:'approved',updatedAt};
const review={id:id(1),updatedAt,process:{name:'Prepare the next contact review',state:'draft',trigger_key:'contact.created',trigger_config:{},conditions:[],created_by:id(9)},acts:[{id:id(8),position:1,action_kind:'owner.task',tool_key:null,config:{title:'Prepare an internal client review'}}]};
export function useOwnerTaskAutomations(){
 const f=useContext(FixtureContext),[opened,setOpened]=useState(false),[inspected,setInspected]=useState(false);
 const refuse=f.mode==='refused'||f.scope==='B';
 const outcome=f.mode==='unavailable'?{status:'unavailable'}:{status:'ready',processId:review.id,approvalId:item.approvalId,occurrenceId:item.occurrenceId,approvalStatus:'approved',recordedOutcome:'executed',decidedAt:updatedAt,title:'Prepare an internal client review',originalTask:f.mode==='unconfirmed'?{state:'unconfirmed'}:{state:'verified',taskId:id(4),receiptId:id(5),runId:id(6)},currentTask:{state:'not_read'}};
 return {scopeKey:f.scope,busy:false,needsRefresh:false,read:refuse?{status:'refused'}:{status:'ready',items:[review],hasMore:false},feedback:null,
  history:!opened?{status:'closed'}:refuse?{status:'refused',processId:review.id}:{status:'ready',processId:review.id,list:{items:[item],hasMore:false},selected:inspected?item:null,outcome:inspected?outcome:null},
  refresh:async()=>{setOpened(false);setInspected(false)},closeHistory:()=>{setOpened(false);setInspected(false)},openHistory:async()=>setOpened(true),inspectOutcome:async()=>setInspected(true),control:async()=>{throw Error('Fixture forbids business control');}};
}
