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
