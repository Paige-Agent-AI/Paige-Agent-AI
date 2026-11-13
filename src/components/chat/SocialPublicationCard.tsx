import {useEffect,useState,type ReactNode} from "react";
import {Link} from "react-router-dom";
import {supabase} from "@/integrations/supabase/client";
import {PaigeConfirmCard} from "./PaigeConfirmCard";
import {doorFace,type PublishFace,PUBLICATION_STATUS_WORDS} from "@/solo/publish-piece";
import {readFunctionErrorBody} from "@/lib/integrations/connectError";
import {socialPublicationTarget,type SocialPublicationReference} from "@/solo/social-publication-reference";
import type {WorkspaceLinkTenant} from "@/lib/links/workspaceLinks";
import {readSocialSchedule,socialScheduleLabel} from "@/solo/social-schedule-fields";

type Props={reference:SocialPublicationReference;tenantId:string|null|undefined;account?:WorkspaceLinkTenant|null;returnMessageId?:string};
/** Protected read only. Rendering/history cannot publish or reconcile an attempt. */
export function SocialPublicationCard({reference,tenantId,account,returnMessageId}:Props){
 const [source,setSource]=useState<{title:string;caption:string;status:string;truncated:boolean;time?:string}|null>(null),[unavailable,setUnavailable]=useState(false);
 const target=socialPublicationTarget(reference,tenantId,account,returnMessageId);
 useEffect(()=>{let current=true;setSource(null);setUnavailable(false);if(!target){setUnavailable(true);return;}
  void supabase.functions.invoke("social-publish-command",{body:{action:"inspect",expected_tenant_id:reference.tenant_id,content_id:reference.content_id,
    ...(reference.publication_id?{publication_id:reference.publication_id}:{})}}).then(({data,error})=>{
    if(!current)return;
    if(error||data?.state!=="available"||data?.reference?.tenant_id!==reference.tenant_id||data?.reference?.content_id!==reference.content_id
      ||data?.reference?.publication_id!==reference.publication_id||data?.reference?.content_revision!==reference.content_revision){setUnavailable(true);return;}
    const scheduled=readSocialSchedule(data.schedule);
    setSource({title:typeof data.title==="string"?data.title:"Saved Social post",caption:typeof data.caption==="string"?data.caption:"",status:String(data.status),truncated:data.caption_truncated===true,...(scheduled?{time:socialScheduleLabel(scheduled)}:{})});
   }).catch(()=>{if(current)setUnavailable(true);});return()=>{current=false;};
 },[target,reference.tenant_id,reference.content_id,reference.content_revision,reference.publication_id]);
 return <section className="mt-2 min-w-0 rounded-md border border-border bg-muted/30 p-3" aria-label="Original Social post">
  {source?<><p className="text-sm font-medium">{source.title}</p><p className="mt-1 text-xs text-muted-foreground">{PUBLICATION_STATUS_WORDS[source.status]??(source.status==="saved_source"?"Saved draft · not published":"Status unverified")}</p>
   {source.time&&<p className="mt-1 text-xs text-muted-foreground">{source.time}</p>}<p className="mt-2 whitespace-pre-wrap break-words text-sm">{source.caption}</p>{source.truncated&&<p className="text-xs text-muted-foreground">Caption excerpt. Open the saved post for the full content.</p>}</>
   :<p role="status" className="text-sm text-muted-foreground">{unavailable?"The original post could not be read in this workspace.":"Reading the original Social post…"}</p>}
  {target&&<Link className="mt-2 inline-flex text-sm font-medium underline underline-offset-2" to={target}>Open original post{reference.publication_id?", receipt and performance":""}</Link>}
 </section>;
}

type ApprovalProps=Props&{fingerprint?:string;summary:string;disabled?:boolean;focusOnMount?:boolean;onApprove:(fps:string[])=>void;onDeny:(fps:string[])=>void;children?:ReactNode};
/** The original Chat approve/deny control, backed by a fresh read of its one Social proposal. */
export function SocialApprovalReview({reference,tenantId,account,fingerprint,summary,disabled,focusOnMount,onApprove,onDeny,children}:ApprovalProps){
 const [preview,setPreview]=useState<Extract<PublishFace,{face:"approval_required"}>|null>(null),[failed,setFailed]=useState(false);
 const target=socialPublicationTarget(reference,tenantId,account);
 useEffect(()=>{let current=true;setPreview(null);setFailed(false);
  if(!target||!fingerprint||!/^[a-f0-9]{16}$/.test(fingerprint)){setFailed(true);return;}
  void (async()=>{try{const {data,error}=await supabase.functions.invoke("social-publish-command",{body:{action:"approval_read",expected_tenant_id:reference.tenant_id,
    content_id:reference.content_id,expected_content_revision:reference.content_revision,fingerprint}});
   const errorBody=error?await readFunctionErrorBody(error,data):null;
   const face=doorFace(data?.state==="approval_available"?{...data,state:"approval_required"}:null,errorBody);
   if(!current)return;
   if(face.face!=="approval_required"||face.fingerprint!==fingerprint||!face.expiresAt||Date.parse(face.expiresAt)<=Date.now()){setFailed(true);return;}
   setPreview(face);
  }catch{if(current)setFailed(true);}})();return()=>{current=false;};
 },[target,fingerprint,reference.tenant_id,reference.content_id,reference.content_revision]);
 if(!preview)return <div role="status" className="mt-2 text-sm text-muted-foreground">{failed?"This Social proposal could not be verified. Open the original post to review it again.":"Reading the exact Social proposal…"}{failed&&target&&<Link className="ml-1 underline" to={target}>Open original post</Link>}</div>;
 return <section className="mt-2 min-w-0" aria-label="Review exact Social post">
  <div className="rounded-md border border-border p-3"><p className="text-sm font-medium">{preview.channelLabel} · {preview.platform}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm">{preview.caption}</p>
   {!!preview.media?.length&&<div className="mt-3 flex max-w-full gap-2 overflow-x-auto">{preview.media.map(asset=>asset.type==="video"?<video key={asset.contentId} src={asset.url} controls preload="metadata" className="h-40 max-w-full rounded-md" aria-label={asset.alt}/>:<img key={asset.contentId} src={asset.url} alt={asset.alt} className="h-40 max-w-full rounded-md object-contain"/>)}</div>}
   <p className="mt-2 text-xs text-muted-foreground">{preview.schedule?`${preview.operation === "cancel_schedule"?"Stop the original schedule":"Commit the exact future instruction"}: ${socialScheduleLabel(preview.schedule)}. Scheduled acceptance is separate from publication.`:"Publishes once, immediately after approval."}</p></div>
  {children??<PaigeConfirmCard actions={[{summary:preview.summary||summary,fingerprint:preview.fingerprint}]} disabled={disabled} focusOnMount={focusOnMount} onApprove={onApprove} onDeny={onDeny}/>}
 </section>;
}
