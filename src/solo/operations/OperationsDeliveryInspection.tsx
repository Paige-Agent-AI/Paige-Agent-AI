import{useCallback,useEffect,useRef,useState}from"react";
import type{TeamMemberRecord}from"@/solo/team-workspace-contract";
import type{StaffDeliveryScope}from"./operations-delivery-staff";
import{browserDeliveryRecoveryStorage,readDeliveryRecovery}from"./operations-delivery-local-recovery";
import{OperationsDeliverablePreparation}from"./OperationsDeliverablePreparation";
import{OperationsStaffDeliveryReview}from"./OperationsStaffDeliveryReview";
import"./operations-views.css";
import"./operations-delivery-inspection.css";
export type DeliveryInspectionProps={scope:StaffDeliveryScope;members:TeamMemberRecord[];theme?:string;initialMode?:"preparation"|"review";reviewOnly?:boolean;registerCloseGuard?:(guard:()=>boolean)=>()=>void;onSubmitted?:()=>void|Promise<void>};
/** One existing Delivery inspection at a time, without a general Planning edit grant. */
export function OperationsDeliveryInspection({scope,members,theme="dark",initialMode="review",reviewOnly=false,registerCloseGuard,onSubmitted}:DeliveryInspectionProps){
 const guards=useRef(new Set<()=>boolean>()),[hint,setHint]=useState("");
 const [mode,setMode]=useState<"preparation"|"review">(()=>{if(reviewOnly)return"review";const retained=readDeliveryRecovery(browserDeliveryRecoveryStorage(),scope);if(retained.kind!=="retained")return initialMode;const r=retained.recovery;return r.kind==="attempt"&&r.action.kind==="submit"||r.kind==="draft"&&r.draft.kind==="preparation"?"preparation":"review";});
 const guard=useCallback(()=>{for(const check of guards.current)if(!check())return false;return true;},[]);
 const register=useCallback((check:()=>boolean)=>{guards.current.add(check);return()=>{guards.current.delete(check);};},[]);
 useEffect(()=>registerCloseGuard?.(guard),[registerCloseGuard,guard]);
 const select=(next:"preparation"|"review")=>{if(reviewOnly||next===mode)return;if(!guard()){setHint("Finish or explicitly clear the current draft, or inspect its unconfirmed change, before opening another decision.");return;}setHint("");setMode(next);};
 return<section className="ops-delivery-inspection" aria-label="Delivery inspection">
  {!reviewOnly&&<div className="ops-view-segments" role="group" aria-label="Delivery inspection mode"><button type="button" aria-pressed={mode==="preparation"} onClick={()=>select("preparation")}>Prepare a version</button><button type="button" aria-pressed={mode==="review"} onClick={()=>select("review")}>Review delivery</button></div>}
  {hint&&<p role="status">{hint}</p>}
  {!reviewOnly&&mode==="preparation"?<OperationsDeliverablePreparation scope={scope} members={members} theme={theme} registerCloseGuard={register} onSubmitted={onSubmitted}/>:<OperationsStaffDeliveryReview scope={scope} members={members} theme={theme} registerCloseGuard={register}/>}
 </section>;
}
