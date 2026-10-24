import{useEffect,useRef,useState}from"react";
import type{TeamMemberRecord}from"@/solo/team-workspace-contract";
import{readPendingDeliveryReviews,type PendingDeliveryReview,type PendingDeliveryReviews}from"./operations-delivery-reviews";
import{deliverySourceCaller}from"./operations-delivery-source";
import{OperationsAssignee}from"./OperationsAssignee";
import"./operations-views.css";
import"./operations-delivery-inspection.css";
export type DeliveryReviewQueueProps={actorId:string;tenantId:string;members:TeamMemberRecord[];refreshKey?:number;onInspect:(review:PendingDeliveryReview)=>void};
/** Existing scoped nominations only; this is not a task source or generic work-edit grant. */
export function OperationsDeliveryReviewQueue({actorId,tenantId,members,refreshKey=0,onInspect}:DeliveryReviewQueueProps){
 const key=JSON.stringify([actorId,tenantId]),live=useRef(key);live.current=key;
 const [revision,setRevision]=useState(0),[state,setState]=useState<{key:string;loading:boolean;read:PendingDeliveryReviews|null}>({key,loading:true,read:null});
 useEffect(()=>{let cancelled=false;const same=()=>!cancelled&&live.current===key;setState({key,loading:true,read:null});
  void readPendingDeliveryReviews(deliverySourceCaller,{actorId,tenantId},same).then(read=>{if(same())setState({key,loading:false,read});}).catch(()=>{if(same())setState({key,loading:false,read:{kind:"unavailable"}});});
  return()=>{cancelled=true;};
 },[key,actorId,tenantId,revision,refreshKey]);
 const visible=state.key===key?state:null,data=visible?.read?.kind==="ready"?visible.read:null;
 // A confirmed empty review queue should not displace the owner's daily work.
 if(data&&data.reviews.length===0&&data.unavailableCount===0&&!data.hasMore)return null;
 return<section className="ops-views ops-delivery-review-queue" aria-label="Your deliverable reviews">
  <header className="ops-view-heading"><div><h2 className="ops-view-section-title">Ready for your review</h2><p>Inspect the exact submitted work before recording your decision.</p></div><button type="button" disabled={!visible||visible.loading} onClick={()=>setRevision(n=>n+1)}>Refresh review assignments</button></header>
  {!visible||visible.loading?<p role="status">Reading your review assignments...</p>:!data?<div role="status"><h3>Review assignments unavailable</h3><p>Current work and source access could not be verified. Refresh to inspect your recorded nominations.</p></div>:<>
   {data.reviews.length===0?<p>No deliverables awaiting your review in the readable nominations.</p>:<div className="ops-view-table-scroll" tabIndex={0} role="region" aria-label="Pending deliverable reviews"><table className="ops-work-table"><thead><tr><th>Submitted work</th><th>Submitted by</th><th>Next decision</th></tr></thead><tbody>{data.reviews.map(review=><tr key={review.submission_id}><td data-label="Submitted work"><strong>{review.title}</strong><small>Submission {review.revision_no}</small></td><td data-label="Submitted by">{members.some(m=>m.user_id===review.submitted_by)?<OperationsAssignee member={members.find(m=>m.user_id===review.submitted_by)}/>:<span>Member unavailable</span>}</td><td data-label="Next decision"><button type="button" className="ops-view-text-action" onClick={()=>{if(live.current===key&&!state.loading)onInspect(review);}}>Review deliverable</button></td></tr>)}</tbody></table></div>}
   {data.unavailableCount>0&&<p role="status">{data.unavailableCount} nominations could not be inspected with current source access.</p>}
   {data.hasMore&&<p>More nominations are outside this read. This section shows up to 40 readable or unavailable nominations.</p>}
  </>}
 </section>;
}
