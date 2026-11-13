// Selection-only consumers of the original Social door. It alone owns approval,
// claim, publishing, reconciliation and receipts. Model arguments never approve.
import { confirmFingerprint } from "../confirm-fingerprint.ts";
import { SOCIAL_POST_PLATFORMS } from "../social-provider/mod.ts";
import { readSocialPublicationReference } from "./reference.ts";
import { readSocialSchedule, storedSocialSchedule, SOCIAL_SCHEDULE_SCHEMA } from "./schedule.ts";

export const SOCIAL_PROPOSAL_KEY="social.post_publish";
export const SOCIAL_PUBLISH_TOOL="social_post_publish";
export const SOCIAL_READ_TOOL="read_social_publication";
export const SOCIAL_CHECK_TOOL="check_social_publication";
export const SOCIAL_CHAT_TOOLS:ReadonlySet<string>=new Set([SOCIAL_PUBLISH_TOOL,SOCIAL_READ_TOOL,SOCIAL_CHECK_TOOL]);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const object=(x:unknown):Record<string,unknown>|null=>x&&typeof x==="object"&&!Array.isArray(x)?x as Record<string,unknown>:null;
export function socialChatToolDefs(){return [
  {type:"function" as const,function:{name:SOCIAL_READ_TOOL,description:"Read an exact saved Social content piece or its original publication receipt by IDs. A saved draft is not a published post. The result supplies a protected reopen card, not a model-authored URL.",parameters:{type:"object",properties:{content_id:{type:"string",format:"uuid"},publication_id:{type:"string",format:"uuid"}},required:["content_id"]}}},
  {type:"function" as const,function:{name:SOCIAL_PUBLISH_TOOL,description:"Prepare one saved Social piece for immediate publishing or an exact future instruction. Read the saved piece first. Omit schedule only for an explicitly requested immediate post; never infer an unchosen time, zone or DST occurrence. The original door returns caption/media/destination/time for human approval and cannot approve itself. Reschedule or cancel_schedule targets only an existing original publication and current version; it changes the time, never replaces the job or its caption/media. Uncertain operations must be checked, never retried.",parameters:{type:"object",properties:{content_id:{type:"string",format:"uuid"},expected_content_revision:{type:"string"},platform:{type:"string",enum:[...SOCIAL_POST_PLATFORMS]},caption:{type:"string",maxLength:2200},schedule:SOCIAL_SCHEDULE_SCHEMA,operation:{type:"string",enum:["publish","reschedule","cancel_schedule"]},publication_id:{type:"string",format:"uuid"},publication_version:{type:"integer",minimum:1}},required:["content_id","expected_content_revision","platform","caption"]}}},
  {type:"function" as const,function:{name:SOCIAL_CHECK_TOOL,description:"Read back an original unresolved Social publication attempt without publishing again. Use only the content_id and publication_id returned by that original attempt.",parameters:{type:"object",properties:{content_id:{type:"string",format:"uuid"},publication_id:{type:"string",format:"uuid"}},required:["content_id","publication_id"]}}},
];}
export type SocialApprovalQuery={eq(key:string,value:unknown):SocialApprovalQuery;in(key:string,value:string[]):SocialApprovalQuery;is(key:string,value:null):SocialApprovalQuery;not(key:string,operator:string,value:null):SocialApprovalQuery;gt(key:string,value:string):SocialApprovalQuery;limit(n:number):PromiseLike<{data:unknown;error:unknown}>};
export type SocialChatDeps={admin:{from(name:string):{select(columns:string):SocialApprovalQuery}};invoke(body:Record<string,unknown>):Promise<{data:unknown;error:unknown}>};
type Context={tenantId:string|null;userId:string;toolName:string;args:Record<string,unknown>;approved:ReadonlySet<string>;sameToolCalls:number;pinned?:{fingerprint:string;args:unknown}};
export type SocialChatResult={content:Record<string,unknown>;tokens?:string[];spent?:string;refusal?:"ambiguous"|"unclaimable"|"lookup_failed";approvalUnavailable?:true};
export function socialStoredCall(value:unknown):Record<string,unknown>|null{
 const a=object(value);
 const schedule=a?.schedule===undefined?undefined:storedSocialSchedule(a.schedule,Date.now());
 if(schedule===null)return null;
 const operation=a?.operation;
 if(operation!==undefined&&operation!=="reschedule"&&operation!=="cancel_schedule")return null;
 if(operation&&(typeof a?.publication_id!=="string"||!UUID.test(a.publication_id)||!Number.isSafeInteger(a.publication_version)||Number(a.publication_version)<1||!schedule))return null;
 return a&&typeof a.content_id==="string"&&UUID.test(a.content_id)&&typeof a.content_revision==="string"&&a.content_revision.length<=80&&Number.isFinite(Date.parse(a.content_revision))
   &&typeof a.platform==="string"&&(SOCIAL_POST_PLATFORMS as readonly string[]).includes(a.platform)&&typeof a.caption==="string"&&a.caption.length<=2200
   &&typeof a.account_id==="string"&&UUID.test(a.account_id)&&typeof a.connection_id==="string"&&UUID.test(a.connection_id)
   &&typeof a.provider_account_id==="string"&&typeof a.profile_key==="string"&&typeof a.channel_label==="string"
   ? {content_id:a.content_id,expected_content_revision:a.content_revision,platform:a.platform,caption:a.caption,...(schedule?{schedule}:{}),
     ...(operation?{operation,publication_id:a.publication_id,publication_version:a.publication_version}:{})}:null;
}
async function answer(reply:{data:unknown;error:unknown}):Promise<Record<string,unknown>|null>{
 let data=reply.data;
 if(reply.error){try{const ctx=object(reply.error)?.context as {json?:()=>Promise<unknown>}|undefined;data=await ctx?.json?.();}catch{return null;}}
 return object(data);
}
const stop="Do not call this tool again in this reply. Check the original attempt before any new publishing request.";
function refuse(reason:NonNullable<SocialChatResult["refusal"]>,tokens:string[]):SocialChatResult{return {refusal:reason,tokens,content:{success:false,not_applied:true,error:"The original Social approval could not be uniquely verified. Nothing was published by this call.",note:stop}};}
/** Local alias only; the original resume family/catalog remains unchanged. */
export function socialResumeShape(key:unknown,args:unknown):{family:"publish";callArgs:Record<string,unknown>}|null{
 const call=key===SOCIAL_PROPOSAL_KEY?socialStoredCall(args):null;return call?{family:"publish",callArgs:call}:null;
}
export async function dispatchSocialChat(ctx:Context,deps:SocialChatDeps):Promise<SocialChatResult>{
 if(!SOCIAL_CHAT_TOOLS.has(ctx.toolName)||!ctx.tenantId||!UUID.test(ctx.tenantId))return refuse("unclaimable",[]);
 let args=ctx.args,fp:string|undefined;const tokens:string[]=[];
 if(ctx.toolName===SOCIAL_PUBLISH_TOOL&&(ctx.pinned||ctx.approved.size)){
  try{
   let rows:Record<string,unknown>[]=[];
   if(ctx.pinned)rows=[{fingerprint:ctx.pinned.fingerprint,args:ctx.pinned.args}];
   else{
    const read=await deps.admin.from("paige_pending_confirmations").select("fingerprint,args")
     .eq("tenant_id",ctx.tenantId).eq("user_id",ctx.userId).eq("tool_name",SOCIAL_PROPOSAL_KEY)
     .in("fingerprint",[...ctx.approved]).is("thread_id",null).is("scoped_client_id",null).is("consumed_at",null)
     .not("server_issued_at","is",null).not("issued_in_request","is",null).gt("expires_at",new Date().toISOString()).limit(3);
    if(read.error||!Array.isArray(read.data))return refuse("lookup_failed",tokens);
    rows=read.data.map(object).filter((r):r is Record<string,unknown>=>!!r);
   }
   for(const r of rows)if(typeof r.fingerprint==="string"&&ctx.approved.has(r.fingerprint))tokens.push(r.fingerprint);
   if(rows.length>1||(!ctx.pinned&&ctx.sameToolCalls!==1))return refuse("ambiguous",tokens);
   if(rows.length!==1)return refuse("unclaimable",tokens);
   const row=rows[0],stored=object(row.args),call=socialStoredCall(stored);
   if(typeof row.fingerprint!=="string"||!ctx.approved.has(row.fingerprint)||!call||!stored
    ||await confirmFingerprint(SOCIAL_PROPOSAL_KEY,stored)!==row.fingerprint)return refuse("unclaimable",tokens);
   fp=row.fingerprint;args=call;
  }catch{return refuse("lookup_failed",tokens);}
 }
 const id=args.content_id;
 if(typeof id!=="string"||!UUID.test(id))return refuse("unclaimable",tokens);
 const publishing=ctx.toolName===SOCIAL_PUBLISH_TOOL;
 if(publishing&&(typeof args.expected_content_revision!=="string"||!Number.isFinite(Date.parse(args.expected_content_revision))||typeof args.caption!=="string"||!args.caption.trim()||args.caption.length>2200))return refuse("unclaimable",tokens);
 if(!publishing&&ctx.toolName===SOCIAL_CHECK_TOOL&&(typeof args.publication_id!=="string"||!UUID.test(args.publication_id)))return refuse("unclaimable",tokens);
 if(publishing&&((args.schedule!==undefined&&!readSocialSchedule(args.schedule,Date.now()))
   ||(args.operation!==undefined&&!["publish","reschedule","cancel_schedule"].includes(String(args.operation)))))return refuse("unclaimable",tokens);
 const body={action:publishing?String(args.operation??"publish"):ctx.toolName===SOCIAL_CHECK_TOOL?"reconcile":"inspect",expected_tenant_id:ctx.tenantId,content_id:id,
  ...(publishing?{expected_content_revision:args.expected_content_revision,caption:args.caption,platform:args.platform,...(args.schedule?{schedule:args.schedule}:{}),
      ...(args.operation&&args.operation!=="publish"?{publication_id:args.publication_id,publication_version:args.publication_version}:{}),...(fp?{approved_fingerprint:fp}:{})}
    :typeof args.publication_id==="string"?{publication_id:args.publication_id}:{})};
 let result:Record<string,unknown>|null=null;try{result=await answer(await deps.invoke(body));}catch{/* uncertain result never triggers another send */}
 if(!result)return {tokens,spent:fp,content:{success:false,outcome_unknown:publishing&&!!fp,error:"The original Social answer could not be confirmed.",note:stop}};
 const recoveryRequired=result.code==="RETRY_PENDING_RECONCILIATION";
 const recoveryReferences=Array.isArray(result.original_attempts)?result.original_attempts.slice(0,6).flatMap(value=>{
  const ref=readSocialPublicationReference(value);return ref&&ref.tenant_id===ctx.tenantId&&ref.content_id===id&&ref.publication_id?[ref]:[];
 }):[];
 let source=result;
 if((publishing||ctx.toolName===SOCIAL_CHECK_TOOL)&&!recoveryRequired){
  try{source=await answer(await deps.invoke({action:"inspect",expected_tenant_id:ctx.tenantId,content_id:id,...(typeof result.publication_id==="string"?{publication_id:result.publication_id}:{})}))??{};}catch{source={};}
 }
 const reference=readSocialPublicationReference(source.reference);
 const validRef=!recoveryRequired&&reference?.tenant_id===ctx.tenantId&&reference.content_id===id?reference:null;
 if(result.state==="approval_required"){
  const approval=object(result.approval);
  if(fp||!validRef||!approval||typeof approval.fingerprint!=="string"||!/^[0-9a-f]{16}$/.test(approval.fingerprint))return {...refuse("unclaimable",tokens),spent:fp};
  return {tokens,content:{success:false,needs_confirm:true,confirm_fingerprint:approval.fingerprint,confirm_summary:approval.summary,
    confirm_expires_at:approval.expires_at,confirm_social_reference:validRef,social_reference:validRef,
    note:"Show the original Social approval card. It reads the exact saved proposal before approval. Nothing is live yet."}};
 }
 const verifiedPublished=!!validRef&&validRef.publication_id!==null&&validRef.publication_id===result.publication_id
  &&validRef.content_revision===args.expected_content_revision&&source.state==="available"&&source.status==="published";
 const verifiedSchedule=!!validRef&&validRef.publication_id===result.publication_id&&validRef.content_revision===args.expected_content_revision
  &&source.state==="available"&&source.status===result.state&&["scheduled","cancelled"].includes(String(result.state));
 const unverifiedPublished=publishing&&result.state==="published"&&!verifiedPublished;
 const producerRef=publishing&&fp&&typeof result.publication_id==="string"?readSocialPublicationReference({schema:1,tenant_id:ctx.tenantId,
  content_id:id,content_revision:args.expected_content_revision,publication_id:result.publication_id}):null;
 const projectedRef=publishing&&typeof result.publication_id==="string"
  ?validRef?.publication_id===result.publication_id&&validRef.content_revision===args.expected_content_revision?validRef:producerRef
  :validRef;
 const success=publishing?result.ok===true&&((result.state==="published"&&verifiedPublished)||verifiedSchedule):result.ok===true&&!!validRef;
 const definitelyNotApplied=!recoveryRequired&&(result.state==="refused"||result.state==="failed"||["REQUEST_INVALID","CONTENT_NOT_FOUND","CONTENT_REVISION_CHANGED","MEDIA_SELECTION_CHANGED","NO_CONNECTION","NEEDS_REAUTH","DESTINATION_AMBIGUOUS","PUBLISHING_NOT_CONFIGURED"].includes(String(result.code)));
 return {tokens,spent:fp,...(["approval_claim_missing","approval_not_available"].includes(String(result.code))?{approvalUnavailable:true as const}:{}),content:{success,
  ...(projectedRef?{social_reference:projectedRef}:{}),
  ...(verifiedSchedule?{schedule:result.schedule,schedule_version:result.schedule_version}:{}),
  ...(recoveryReferences.length?{social_references:recoveryReferences}:{}),
  ...(unverifiedPublished?{state:"unverified"}:typeof result.state==="string"?{state:result.state}:{}),
  ...(ctx.toolName===SOCIAL_READ_TOOL?{source:source.state==="available"?{title:source.title,caption:source.caption,caption_truncated:source.caption_truncated,status:source.status,media_count:source.media_count,
    ...(source.schedule?{schedule:source.schedule,schedule_version:source.schedule_version}:{}),...(source.platform?{platform:source.platform,destination:source.destination}:{})}:null}:{}),
  ...(result.state==="outcome_unknown"||unverifiedPublished||recoveryRequired||result.schedule_change_applied===false?{outcome_unknown:true}:{}),
  ...(recoveryRequired?{recovery_required:true}:{}),...(definitelyNotApplied?{not_applied:true}:{}),
  error:typeof result.error==="string"?result.error:typeof result.message==="string"?result.message:undefined,note:stop}};
}
