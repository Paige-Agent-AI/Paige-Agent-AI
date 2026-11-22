import { SOCIAL_POST_PLATFORMS } from "../social-provider/mod.ts";
import { readSocialPublicationReference, type SocialPublicationReference } from "./reference.ts";
import { readSocialSchedule, storedSocialSchedule, type SocialSchedule } from "./schedule.ts";
type Query = { select(columns:string):Query;eq(key:string,value:unknown):Query;maybeSingle():PromiseLike<{data:unknown;error:unknown}> };
export type SocialSourceReadCaller = {from(table:string):Query;rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
const record=(x:unknown):Record<string,unknown>|null=>x&&typeof x==="object"&&!Array.isArray(x)?x as Record<string,unknown>:null;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export type SocialSourceRead = {state:"available";reference:SocialPublicationReference;title:string;kind:string;caption:string;caption_truncated:boolean;status:string;media_count:number|null;platform?:string;destination?:string;schedule?:SocialSchedule;schedule_version?:number} | {state:"unavailable";code:string};
function snapshotCount(value:unknown):number|null {
  if(value===undefined||value===null)return 0; // Original text-only receipts predate media snapshots.
  if(typeof value!=="string"||value.length>100_000)return null;
  try {const parsed=JSON.parse(value);return Array.isArray(parsed)&&parsed.length<=20?parsed.length:null;}catch{return null;}
}
/** Caller-JWT original Content/publication read. It proposes, claims and publishes nothing. */
export async function readSocialSource(caller:SocialSourceReadCaller,tenantId:string,args:Record<string,unknown>):Promise<SocialSourceRead> {
  const id=args.content_id,publication=args.publication_id;
  if(!UUID.test(tenantId)||typeof id!=="string"||!UUID.test(id)||(publication!==undefined&&(typeof publication!=="string"||!UUID.test(publication))))return {state:"unavailable",code:"SOCIAL_SOURCE_INVALID"};
  if(typeof publication==="string") {
    const result=await caller.rpc("content_publication_list",{p_content_id:id,p_tenant_id:tenantId});
    if(result.error||!Array.isArray(result.data))return {state:"unavailable",code:"SOCIAL_SOURCE_UNREADABLE"};
    const matching=result.data.map(record).filter(r=>r?.id===publication&&r.tenant_id===tenantId&&r.content_id===id);
    if(matching.length!==1)return {state:"unavailable",code:"SOCIAL_SOURCE_NOT_FOUND"};
    const row=matching[0]!,stored=record(row.request_args);
    if(typeof row.platform!=="string"||!(SOCIAL_POST_PLATFORMS as readonly string[]).includes(row.platform)||!stored||typeof stored.caption!=="string"
      ||stored.caption.length>2200||typeof stored.account_id!=="string"||!UUID.test(stored.account_id))return {state:"unavailable",code:"SOCIAL_RECEIPT_UNVERIFIED"};
    const reference=readSocialPublicationReference({schema:1,tenant_id:tenantId,content_id:id,content_revision:stored.content_revision,publication_id:publication});
    if(!reference)return {state:"unavailable",code:"SOCIAL_RECEIPT_UNVERIFIED"};
    const states=["registered","approved","publishing","outcome_unknown","published","partial","failed","refused","scheduled","schedule_changing","cancelled"];
    const status=typeof row.status==="string"&&states.includes(row.status)?row.status:"unverified";
    if(status==="published"&&(!row.provider_post_id||!row.provider_request_id||typeof row.provider_post_url!=="string"||!row.provider_post_url.startsWith("https://")))return {state:"unavailable",code:"SOCIAL_RECEIPT_UNVERIFIED"};
    const saved=record(record(row.provider_response)?.schedule),schedule=readSocialSchedule(saved?.current),version=saved?.version;
    if(["scheduled","cancelled"].includes(status)&&(!row.provider_request_id||!schedule||!storedSocialSchedule(stored.schedule)||!Number.isSafeInteger(version)||Number(version)<1))return {state:"unavailable",code:"SOCIAL_RECEIPT_UNVERIFIED"};
    return {state:"available",reference,title:"Original Social post",kind:"publication",caption:stored.caption,caption_truncated:false,status,media_count:snapshotCount(stored.media_snapshot),platform:row.platform,
      ...(typeof stored.channel_label==="string"?{destination:stored.channel_label}:{}),...(schedule&&Number.isSafeInteger(version)?{schedule,schedule_version:Number(version)}:{})};
  }
  const result=await caller.from("marketing_content").select("id,tenant_id,kind,status,title,body,meta,updated_at").eq("tenant_id",tenantId).eq("id",id).maybeSingle();
  const piece=record(result.data);
  if(result.error||!piece||piece.tenant_id!==tenantId||piece.id!==id||piece.status==="archived")return {state:"unavailable",code:"SOCIAL_SOURCE_NOT_FOUND"};
  if(!["text","image","video"].includes(String(piece.kind)))return {state:"unavailable",code:"SOCIAL_SOURCE_FORMAT_UNAVAILABLE"};
  const reference=readSocialPublicationReference({schema:1,tenant_id:tenantId,content_id:id,content_revision:piece.updated_at,publication_id:null});
  if(!reference)return {state:"unavailable",code:"SOCIAL_SOURCE_UNVERIFIED"};
  const ids=record(piece.meta)?.media_content_ids;
  const caption=typeof piece.body==="string"?piece.body:"";
  const mediaCount=["image","video"].includes(String(piece.kind))?1:ids===undefined?0:Array.isArray(ids)&&ids.length<=20&&ids.every(x=>typeof x==="string"&&UUID.test(x))?ids.length:null;
  return {state:"available",reference,title:typeof piece.title==="string"?piece.title.slice(0,180):"Saved Social post",kind:String(piece.kind),
    caption:caption.slice(0,2200),caption_truncated:caption.length>2200,status:"saved_source",media_count:mediaCount};
}
