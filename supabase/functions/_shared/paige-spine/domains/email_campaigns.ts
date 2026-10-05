import { defineCapability, objectInputSchema, ownerGrantablePermission } from '../../capability-kit/mod.ts';
import type { SpineCapability } from '../contracts.ts';

// Marketing email (E2b): PAIGE reads the business's campaigns, sees who one would reach, writes or changes a
// draft, and files a draft for the owner's approval. The same RPCs the Marketing › Email editor uses sit
// underneath, called with the signed-in person's own session, so tenant and owner/admin scope are the
// database's (_email_caller_tenant), and each call also names the business the chat is in.
//
// THE BOUNDARY. PAIGE never approves and never sends. Filing for approval freezes the version and creates the
// one approval the owner decides on (owner ruling: one bounded approval); email_campaign_approve is human-only
// behind its guard trigger. Draft and file are `ordinary`: reversible, in-business, and nothing leaves the
// building. The chat's own gate still asks first unless the owner has given PAIGE autonomy for them.
const scope = { source:'server', tenantResolver:'current_user_tenant_id', actorResolver:'authenticated_user', revalidateAt:['before_availability','before_execution','before_receipt'] } as const;
const availability = { resolver:'paige-capability-status', states:['live','needs_approval','not_for_tier','unavailable'] } as const;
const receipt = { rail:true, recorder:'record_capability_run', redaction:'tenant_safe', visibility:'owner_internal' } as const;
const surface = '/solo/:account/growth/email';
const uuid = {type:'string',format:'uuid'} as const;
const words = (max:number) => ({type:'string',maxLength:max}) as const;
const list = {type:'array',items:{type:'string',maxLength:120},maxItems:40} as const;

export const EMAIL_CAMPAIGN_KINDS = ['standard','newsletter','announcement','promotion','reengagement','event','welcome','custom'] as const;
export const EMAIL_CAMPAIGN_GOALS = ['none','form_submission','booking','deal_created','invoice_paid'] as const;

export const EMAIL_CAMPAIGNS_READ_CAPABILITY = defineCapability({
  identity:{id:'email_campaigns.read',version:1,domain:'email_campaigns',owner:'marketing',humanSurface:surface,description:'Read the business\'s email campaigns, or one campaign\'s current version, with no recipient names or addresses.'},
  input:objectInputSchema({properties:{campaign_id:{anyOf:[uuid,{type:'null'}]},limit:{type:'integer',minimum:1,maximum:50}},required:[]}),
  effect:'read',governance:{actionRiskKey:null,risk:'read_only',approval:'none',requiredPermission:ownerGrantablePermission('email_campaigns.list.read')},
  tenantScope:scope,availability,providerBinding:{kind:'internal',operation:'public.read_email_campaigns',connectionResolver:null},
  idempotency:{mode:'not_applicable'},receipt,outcome:{projector:'capability-record'},
});
export const EMAIL_CAMPAIGN_AUDIENCE_READ_CAPABILITY = defineCapability({
  identity:{id:'email_campaigns.audience',version:1,domain:'email_campaigns',owner:'marketing',humanSurface:surface,description:'Count who one campaign would reach today and why anyone is left out; counts only.'},
  input:objectInputSchema({properties:{campaign_id:uuid},required:['campaign_id']}),
  effect:'read',governance:{actionRiskKey:null,risk:'read_only',approval:'none',requiredPermission:ownerGrantablePermission('email_campaigns.audience.read')},
  tenantScope:scope,availability,providerBinding:{kind:'internal',operation:'public.read_email_campaign_audience',connectionResolver:null},
  idempotency:{mode:'not_applicable'},receipt,outcome:{projector:'capability-record'},
});
export const EMAIL_CAMPAIGN_DRAFT_CAPABILITY = defineCapability({
  identity:{id:'email_campaign_draft',version:1,domain:'email_campaigns',owner:'marketing',humanSurface:surface,description:'Write a new email campaign draft or change the current draft of one; nothing is sent.'},
  input:objectInputSchema({properties:{
    campaign_id:{anyOf:[uuid,{type:'null'}]},
    name:words(200),kind:{type:'string',enum:EMAIL_CAMPAIGN_KINDS},
    subject:words(300),preview_text:words(300),body:words(20000),
    audience:{type:'object',additionalProperties:false,properties:{stages:list,sources:list,tags:list,inactive_days:{anyOf:[{type:'integer',minimum:1,maximum:3650},{type:'null'}]}}},
    segment_id:{anyOf:[uuid,{type:'null'}]},send_at:{anyOf:[{type:'string',maxLength:40},{type:'null'}]},
    goal:{type:'string',enum:EMAIL_CAMPAIGN_GOALS},
  },required:[]}),
  effect:'mutation',governance:{actionRiskKey:'email_campaign_draft',risk:'ordinary',approval:'confirm',requiredPermission:ownerGrantablePermission('email_campaign_draft.execute')},
  tenantScope:scope,availability,providerBinding:{kind:'internal',operation:'public.email_campaign_draft',connectionResolver:null},
  idempotency:{mode:'required',key:'A new campaign carries a key derived from the business, the person and the chat turn; the same key returns the campaign already made. A change to a draft sets the same fields again.',readback:'public.read_email_campaigns',replay:'return_recorded_result'},
  receipt,outcome:{projector:'capability-record'},
});
export const EMAIL_CAMPAIGN_REQUEST_APPROVAL_CAPABILITY = defineCapability({
  identity:{id:'email_campaign_request_approval',version:1,domain:'email_campaigns',owner:'marketing',humanSurface:surface,description:'File one campaign\'s current draft for the owner\'s approval; PAIGE never approves or sends.'},
  input:objectInputSchema({properties:{campaign_id:uuid},required:['campaign_id']}),
  effect:'mutation',governance:{actionRiskKey:'email_campaign_request_approval',risk:'ordinary',approval:'confirm',requiredPermission:ownerGrantablePermission('email_campaign_request_approval.execute')},
  tenantScope:scope,availability,providerBinding:{kind:'internal',operation:'public.email_campaign_submit_for_approval',connectionResolver:null},
  idempotency:{mode:'required',key:'The campaign\'s current version: a version already filed returns the approval waiting on it instead of filing another.',readback:'public.read_email_campaigns',replay:'reconcile_then_return'},
  receipt,outcome:{projector:'capability-record'},
});

const capability = (key:string, chatTool:string, classification:'read'|'mutate', executor:string, kinds:readonly string[], railVisibility:string):SpineCapability => ({
  key,domain:'email_campaigns',owner:'marketing',humanSurface:surface,readiness:'none',
  action:{classification,executor,chatTool,riskPolicyKey:classification==='read'?'read_only':'ordinary',approvalAuthority:classification==='read'?'none':'chat-canonical',
    idempotency:classification==='read'?'Read-only projection for the caller\'s own business; no write.':'Server-derived business and person; a new campaign is keyed to the chat turn, a filed version returns its waiting approval.'},
  outcome:{kinds,projector:'public.read_email_campaigns',railVisibility},
  chatBinding:'LIVE',mindBinding:'UNAVAILABLE',sharedPrimitiveChange:'NONE',maturity:'PARTIAL',
});
export const EMAIL_CAMPAIGN_CAPABILITIES:readonly SpineCapability[] = [
  capability('email_campaigns.read','read_email_campaigns','read','public.read_email_campaigns',['available','refused'],'Read only; no Rail write.'),
  capability('email_campaigns.audience','read_email_campaign_audience','read','public.read_email_campaign_audience',['available','refused'],'Read only; counts, never names or addresses.'),
  capability('email_campaigns.draft','email_campaign_draft','mutate','public.email_campaign_draft',['created','updated','refused','outcome_unknown'],'Recorded after a fresh read shows the draft with the intended subject; nothing is sent.'),
  capability('email_campaigns.request_approval','email_campaign_request_approval','mutate','public.email_campaign_submit_for_approval',['filed','refused','outcome_unknown'],'Recorded after a fresh read shows the version frozen with its approval waiting; the owner alone approves and sends.'),
];
