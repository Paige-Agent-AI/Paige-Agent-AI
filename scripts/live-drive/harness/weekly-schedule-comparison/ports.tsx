import { useSyncExternalStore } from 'react';
let state = {status:'ready', result:'refused', scope:'a'};
const listeners = new Set<()=>void>();
export const observations={network:[] as string[],messages:[] as unknown[],controls:[] as unknown[],refreshes:0};
export function setFixture(patch:Partial<typeof state>){state={...state,...patch};listeners.forEach(f=>f());}
export function useFixture(){return useSyncExternalStore(f=>{listeners.add(f);return()=>listeners.delete(f);},()=>state,()=>state);}
export function useWeeklyOwnerAudience(){return {eligible:true,key:state.scope,context:{activeTenantId:'neutral-'+state.scope,activeUserId:'neutral-owner'}};}
export function useWeeklyResponsibility(){
 const m=useFixture();
 const read = ['loading','refused','unavailable'].includes(m.status)?{status:m.status}:{status:'ready',snapshot:{source:'canonical_process_and_act_receipts',read_at:'2026-10-27T15:00:00Z',business_time_zone:{state:'configured',zone:'America/New_York'},limit:50,has_more:false,
 checks:m.status==='empty'||m.scope==='b'?[]:[{automation_id:'00000000-0000-4000-8000-000000000501',name:'Weekly commitments',revision:7,schedule_status:'paused',schedule:{weekday:1,local_time:'09:00',timezone:'America/New_York'},execution_availability:'held',execution_hold_reason:'Not authorized for future execution',next_run_at:null,intended_next_run_at:null,future_control_at:null,last_run:null,last_verified_run:null}]}};
 return {read,refresh:()=>{observations.refreshes++;},controlBusy:false,control:async(check:any,action:any,schedule:any)=>{observations.controls.push({id:check.automation_id,revision:check.revision,action,schedule,scope:m.scope});return {status:m.result};}};
}
// Unrelated new-draft flow intentionally absent; schedule inspection remains actual source.
export function WeeklyDraftComposer(){return null;}
