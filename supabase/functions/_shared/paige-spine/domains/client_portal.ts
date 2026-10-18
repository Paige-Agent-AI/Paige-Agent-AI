import {defineCapability,objectInputSchema,ownerGrantablePermission} from '../../capability-kit/mod.ts';
import type {SpineCapability} from '../contracts.ts';

// Construction declaration, not an assertion of Chat/Live availability or activation.
export const PORTAL_INVITATION_TOOL='client_portal_invitation_send';
export const PORTAL_INVITATION_CAPABILITY=defineCapability({
 identity:{id:'client.portal_invite',version:1,domain:'client',owner:'clients',humanSurface:'/solo/:account/clients/portal',description:'Invite one existing CRM customer through the incumbent recipient-bound invitation and email sender. Provider acceptance is not delivery or customer acceptance.'},
 input:objectInputSchema({properties:{contact_id:{type:'string',format:'uuid'}},required:['contact_id']}),
 effect:'external_effect',
 governance:{actionRiskKey:'client_portal_invitation_send',risk:'high',approval:'confirm',requiredPermission:ownerGrantablePermission('client.portal_invite.execute')},
 tenantScope:{source:'server',tenantResolver:'current_user_tenant_id',actorResolver:'authenticated_user',revalidateAt:['before_availability','before_execution','before_receipt']},
 availability:{resolver:'paige-capability-status',states:['live','needs_approval','unavailable']},
 providerBinding:{kind:'internal',operation:'edge.send-portal-invite',connectionResolver:null},
 idempotency:{mode:'required',key:'Actual actor/business/operation and exact native CRM recipient proposal. The existing log owns the same delivery key and payload during bounded approved recovery; an unknown send never becomes a new send.',readback:'public.read_client_portal_invitation_delivery',replay:'reconcile_then_return'},
 receipt:{rail:true,recorder:'record_capability_run',redaction:'tenant_safe',visibility:'owner_internal'},
 outcome:{projector:'capability-record'},
});

export const PORTAL_INVITATION={
 key:'client.portal_invite',domain:'client',owner:'clients',humanSurface:'/solo/:account/clients/portal',readiness:'none',
 action:{classification:'external_effect',executor:'public.create_client_portal_invitation',chatTool:'client_portal_invitation_send',seatAuthority:'door-seat',riskPolicyKey:'high',approvalAuthority:'chat-canonical',
  idempotency:'The command redeems one trusted canonical confirmation for the exact native CRM proposal and actor/business/operation. The incumbent producer and email_send_log retain original receipts; an uncertain send keeps its same provider key/payload and needs a fresh canonical approval cycle before bounded effectful recovery.'},
 outcome:{kinds:['approval_required','provider_accepted','refused','failed','held','outcome_unknown'],projector:'public.read_client_portal_invitation_delivery',railVisibility:'Owner-internal canonical invitation, email log and capability receipt. Provider acceptance is not delivery, an open, human read or invitation acceptance.'},
 // LIVE is this manifest's mandatory source-binding value for a mutating tool; it is
 // NOT authenticated customer/provider acceptance or runtime activation. Maturity stays PARTIAL.
 chatBinding:'LIVE',mindBinding:'UNAVAILABLE',sharedPrimitiveChange:'NONE',maturity:'PARTIAL',
}as const satisfies SpineCapability;

// ─── E09 Slice M: the customer portal menu ──────────────────────────────────────────────────────
//
// Which entries a tenant's customers see in their portal menu, in what order and under what names.
// ONE store (tenants.features.portal_config.modules) and ONE writer (public.set_tenant_portal_config,
// owner/admin of the tenant or an ancestor agency, shape-validated by migration 20271110060000). The
// executor (_shared/client-portal-menu.ts) merges the named entries into the stored overlay by key and
// sends the full array, then re-reads it; nothing the model passes can name the tenant.
//
// Home and Messages are always on and keep their names; Get help, Account, Settings and Sign out are
// fixed chrome the overlay cannot reach (owner ruling 2026-10-18). An entry whose page does not exist yet
// (Payments) is registered but never offered. The overlay is presentation only: it never grants a module,
// and an unknown key is inert in the menu.
//
// §2: the model-facing key list names ONLY the core entries every business can have. An opt-in entry (the
// funding preset's keys, Approvals, Business, Affiliate) is named to Paige only by read_tenant_portal_menu, and
// only for a business whose own Playbook catalog lists it — never in a description every tenant's Paige sees.
import { PORTAL_MENU_OFFERED_CORE_KEYS } from '../../client-portal-menu.ts';

const MENU_SURFACE='/solo/:account/clients/portal';
const MENU_SCOPE={source:'server',tenantResolver:'current_user_tenant_id',actorResolver:'authenticated_user',revalidateAt:['before_availability','before_execution','before_receipt']} as const;
const MENU_AVAILABILITY={resolver:'paige-capability-status',states:['live','needs_approval','not_for_tier','unavailable']} as const;
export const PORTAL_MENU_KNOWN_KEYS_TEXT=PORTAL_MENU_OFFERED_CORE_KEYS.join(', ');

export const PORTAL_MENU_CONFIGURE_CAPABILITY=defineCapability({
 identity:{id:'client.portal_menu_configure',version:1,domain:'client',owner:'clients',humanSurface:MENU_SURFACE,
  description:'Show, hide, rename or reorder entries in this business\'s customer portal menu. Home and Messages are always on and keep their names. Presentation only; the owner approves it first.'},
 input:objectInputSchema({
  description:'The menu entries to change. Entries you do not name keep exactly what the owner set before.',
  properties:{
   entries:{type:'array',minItems:1,maxItems:40,description:`One object per entry to change. key is one of: ${PORTAL_MENU_KNOWN_KEYS_TEXT}, or another key read_tenant_portal_menu lists for this business.`,
    items:{type:'object',additionalProperties:false,required:['key'],properties:{
     key:{type:'string',maxLength:40,description:'The entry\'s key, from read_tenant_portal_menu.'},
     visible:{type:'boolean',description:'false hides it from every client of this business; true shows it again.'},
     order:{type:'number',minimum:0,maximum:1000,description:'Its position within its group; lower comes first.'},
     label:{type:'string',maxLength:40,description:'The name clients see, 1 to 40 characters, in the owner\'s own words. An empty string puts back the default name.'},
    }}},
  },
  required:['entries'],
 }),
 effect:'mutation',
 governance:{actionRiskKey:'portal_menu_update',risk:'high',approval:'confirm',requiredPermission:ownerGrantablePermission('client.portal_menu.write')},
 tenantScope:MENU_SCOPE,
 availability:MENU_AVAILABILITY,
 providerBinding:{kind:'internal',operation:'public.set_tenant_portal_config',connectionResolver:null},
 idempotency:{mode:'required',key:'tenant + the merged modules array. Re-sending the same change finds the stored overlay already equal and writes nothing (replayed:true); the Chat confirmation fingerprint is the execute-once guard.',
  readback:'public.read_tenant_portal_menu (caller JWT, invoker rights)',replay:'return_recorded_result'},
 receipt:{rail:true,recorder:'record_capability_run',redaction:'tenant_safe',visibility:'owner_internal'},
 outcome:{projector:'capability-record'},
});

export const PORTAL_MENU_READ_CAPABILITY=defineCapability({
 identity:{id:'client.portal_menu_read',version:1,domain:'client',owner:'clients',humanSurface:MENU_SURFACE,
  description:'What this business\'s customers see in their portal menu: each entry, its name, whether it shows and why not, and what the owner set. Read-only.'},
 input:objectInputSchema({description:'Nothing to choose: it reads the current business.',properties:{},required:[]}),
 effect:'read',
 governance:{actionRiskKey:null,risk:'read_only',approval:'none',requiredPermission:ownerGrantablePermission('client.portal_menu.read')},
 tenantScope:MENU_SCOPE,
 availability:MENU_AVAILABILITY,
 providerBinding:{kind:'internal',operation:'public.read_tenant_portal_menu',connectionResolver:null},
 idempotency:{mode:'not_applicable'},
 receipt:{rail:true,recorder:'record_capability_run',redaction:'tenant_safe',visibility:'owner_internal'},
 outcome:{projector:'capability-record'},
});

export const PORTAL_MENU_CONFIGURE={
 key:'client.portal_menu_configure',domain:'client',owner:'clients',humanSurface:MENU_SURFACE,readiness:'none',
 action:{classification:'mutate',executor:'public.set_tenant_portal_config',chatTool:'portal_menu_update',seatAuthority:'workspace-admin',riskPolicyKey:'high',approvalAuthority:'chat-canonical',
  idempotency:'State-idempotent: the executor merges by key into the stored overlay and, when the result already equals what is stored, returns replayed:true without writing. There is no request key; the Chat confirmation fingerprint is the execute-once guard.'},
 outcome:{kinds:['capability_run'],projector:'public.record_capability_run',railVisibility:'owner_internal'},
 chatBinding:'LIVE',mindBinding:'UNAVAILABLE',sharedPrimitiveChange:'NONE',maturity:'PARTIAL',
}as const satisfies SpineCapability;

export const PORTAL_MENU_READ={
 key:'client.portal_menu_read',domain:'client',owner:'clients',humanSurface:MENU_SURFACE,readiness:'none',
 action:{classification:'read',executor:'public.read_tenant_portal_menu',chatTool:'read_tenant_portal_menu',seatAuthority:'workspace-admin',riskPolicyKey:'read_only',approvalAuthority:'none',
  idempotency:'Read-only on the caller\'s own session: public.read_tenant_portal_menu (invoker rights, tenants RLS) re-proves the current workspace and can_manage_tenant_brand. Writes nothing; the chat executor records one capability receipt per answered call.'},
 outcome:{kinds:['available','refused','unavailable'],projector:'public.read_tenant_portal_menu',railVisibility:'One capability receipt per answered chat question. A read is not a business action.'},
 chatBinding:'LIVE',mindBinding:'UNAVAILABLE',sharedPrimitiveChange:'NONE',maturity:'PARTIAL',
}as const satisfies SpineCapability;

export const PORTAL_MENU_CAPABILITIES=[PORTAL_MENU_READ,PORTAL_MENU_CONFIGURE] as const;

// Model-facing tool JSON, COMPACT (never `name:"…"` alone on a line) so chat-tool-registry-lint counts it
// as entering Chat through the adapter spread. A declaration's input is deep-frozen and the chat adds a
// `confirm` property to every GATED tool (one in action-risk.ts), so the gated writer gets a fresh writable
// copy (the Slice 3 crash). The read is not gated — it is in no RISK row, so neither confirm loop in
// paige-ai-chat touches it — and it carries its declaration's own input by reference, named after its
// public.read_* executor, exactly as read_calendar_booking and read_tenant_knowledge do: that is the only
// shape the capability kit (INT-003) admits as a declared read rather than a hand-written tool.
const writable=(schema:unknown):Record<string,unknown>=>JSON.parse(JSON.stringify(schema));
export const PORTAL_MENU_TOOLS=[
 {type:'function',function:{name:'read_tenant_portal_menu',description:'What clients of this business see in their customer portal menu: each entry\'s key, the name clients see, its group (top, work = "Your work", paperwork = "Paperwork", learn = "Learn"), whether it shows and why not (the owner hid it, or the Playbook does not list it), and what the owner set. Home and Messages are always shown; Get help, Account, Settings and Sign out are always at the bottom. Use it before portal_menu_update, and to answer "what do my clients see in their portal?". Read-only; changes nothing.',parameters:PORTAL_MENU_READ_CAPABILITY.input}},
 {type:'function',function:{name:'portal_menu_update',description:`Show, hide, rename or reorder entries in this business's customer portal menu, for every client of this business. Entries you do not name keep exactly what was set before. Keys: ${PORTAL_MENU_KNOWN_KEYS_TEXT}, plus any other entry read_tenant_portal_menu lists for this business (an entry it does not list cannot be changed). Home and Messages are always on and cannot be renamed or hidden; Get help, Account, Settings and Sign out are fixed. An entry moves only within its own group. A renamed entry changes its menu name only, not the page's heading. Owner or admin only, and the owner approves it on the card first. Call read_tenant_portal_menu first. Never say clients see a change until this reports success.`,parameters:writable(PORTAL_MENU_CONFIGURE_CAPABILITY.input)}},
] as const;
export const PORTAL_MENU_TOOL_NAMES:ReadonlySet<string>=new Set(PORTAL_MENU_TOOLS.map((t)=>t.function.name));
// E09 Slice 6 — Profile & Consent. Two governed READS over the one consent ledger
// (paige_suppressions + paige_consent_events, derived by public._client_communication_state).
// Declared so the callable seams are on the registry (§10); NEITHER is bound to Chat yet, and the
// manifest says so (chatBinding UNAVAILABLE):
//   - the owner read is not yet an owner Chat tool ("can I text Jane?" is a filed follow-up: adding a
//     tool changes the frozen Chat tool rosters the src registration tests pin);
//   - customer-portal assistant turns carry no tools at all today (paige-ai-chat gates every tool
//     family on !customerPortal), so the customer read has no Chat lane to join.
// The customer's WRITERS (client_portal_set_communication_preference,
// client_portal_set_shared_context_consent) are deliberately not declared: this registry admits a
// mutating capability only with a LIVE Chat binding and chat-canonical approval, and a customer's
// own consent choice must never be an owner-approvable Chat action.
export const CLIENT_COMMUNICATION_STATE_READ={
 key:'client.communication_state_read',domain:'client',owner:'clients',humanSurface:'/solo/:account/clients',readiness:'none',
 action:{classification:'read',executor:'public.read_client_communication_state',seatAuthority:'workspace-admin',riskPolicyKey:'read_only',approvalAuthority:'none',
  idempotency:'Read-only on the caller\'s own session. The function re-proves that the named workspace is the caller\'s current one and that the caller is its owner/admin (is_tenant_admin, never a global role), and answers a foreign or missing client with the same refusal. It writes nothing and returns no address, evidence, IP or staff id.'},
 outcome:{kinds:['available','refused'],projector:'public.read_client_communication_state',railVisibility:'None. A display read on the client record; it is not a business action and writes no receipt.'},
 chatBinding:'UNAVAILABLE',mindBinding:'UNAVAILABLE',sharedPrimitiveChange:'NONE',maturity:'PARTIAL',
}as const satisfies SpineCapability;

export const CLIENT_PORTAL_PREFERENCES_READ={
 key:'client.portal_preferences_read',domain:'client',owner:'clients',humanSurface:'/app/settings?view=client-account',readiness:'none',
 action:{classification:'read',executor:'public.client_portal_communication_preferences',riskPolicyKey:'read_only',approvalAuthority:'none',
  idempotency:'Read-only, bound to the signed-in customer\'s own relationship (client_portal_relationship_id); a business argument only narrows it. Exact keys; never an address, evidence pointer, IP or id.'},
 outcome:{kinds:['available','no_relationship','refused'],projector:'public.client_portal_communication_preferences',railVisibility:'None. The customer\'s own settings read.'},
 chatBinding:'UNAVAILABLE',mindBinding:'UNAVAILABLE',sharedPrimitiveChange:'NONE',maturity:'PARTIAL',
}as const satisfies SpineCapability;
