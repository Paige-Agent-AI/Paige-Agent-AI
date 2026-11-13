import {readSocialPublicationReference,type SocialPublicationReference} from "../../supabase/functions/_shared/social-publish-command/reference";
import {workspaceLinkTier,type WorkspaceLinkTenant} from "@/lib/links/workspaceLinks";
export {readSocialPublicationReference,type SocialPublicationReference};
export function socialConfirmReference(value:unknown):SocialPublicationReference|null{
 if(!value||typeof value!=="object"||Array.isArray(value))return null;const r=value as Record<string,unknown>;
 return r.tool==="social_post_publish"?readSocialPublicationReference(r.social_reference):null;
}
export function readSocialPublicationReferences(value:unknown):SocialPublicationReference[]{
 if(!Array.isArray(value))return [];const out:SocialPublicationReference[]=[];
 for(const item of value.slice(0,6)){const ref=readSocialPublicationReference(item);if(ref&&!out.some(r=>r.tenant_id===ref.tenant_id&&r.content_id===ref.content_id&&r.publication_id===ref.publication_id&&r.content_revision===ref.content_revision))out.push(ref);}
 return out;
}
export function socialPublicationTarget(reference:SocialPublicationReference,tenantId:string|null|undefined,account:WorkspaceLinkTenant|null|undefined,returnMessageId?:string):string|null{
 const ref=readSocialPublicationReference(reference),number=String(account?.account_number??"");
 if(!ref||ref.tenant_id!==tenantId||workspaceLinkTier(account)!=="solo"||!/^\d{1,20}$/.test(number))return null;
 const query=new URLSearchParams({social_piece:ref.content_id});if(ref.publication_id)query.set("publication",ref.publication_id);
 if(returnMessageId&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(returnMessageId))query.set("social_return_message",returnMessageId);
 return `/solo/${number}/growth/social?${query}`;
}
/** Navigation only. The existing Hub message reader re-authorizes the same account/message. */
export function socialConversationReturn(search:string,account:string|undefined):string|null{
 const values=new URLSearchParams(search).getAll("social_return_message");
 return account&&/^\d{1,20}$/.test(account)&&values.length===1&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(values[0])
  ?`/solo/${account}/team-hub?${new URLSearchParams({message:values[0]})}`:null;
}
