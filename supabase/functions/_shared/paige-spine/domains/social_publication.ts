import {defineCapability,objectInputSchema,ownerGrantablePermission} from "../../capability-kit/mod.ts";
// The existing publisher declaration remains in its original governance module.
export {SOCIAL_PUBLICATION_CAPABILITY} from "../../social-provider/governance.ts";

const SCOPE={source:"server",tenantResolver:"current_user_tenant_id",actorResolver:"authenticated_user",revalidateAt:["before_availability","before_execution","before_receipt"]} as const;
const RECEIPT={rail:true,recorder:"record_capability_run",redaction:"tenant_safe",visibility:"owner_internal"} as const;
export const SOCIAL_PUBLICATION_READ_CAPABILITY=defineCapability({
 identity:{id:"social.publication_read",version:1,domain:"social",owner:"solo-campaigns",humanSurface:"/solo/:account/growth/social",
  description:"Read one exact saved Social piece or its original publication receipt under current owner/admin authority. A draft is not a published post; current protected readback supplies the result, while saved history keeps IDs only."},
 input:objectInputSchema({properties:{content_id:{type:"string",format:"uuid"},publication_id:{type:"string",format:"uuid"}},required:["content_id"]}),
 effect:"read",governance:{actionRiskKey:null,risk:"read_only",approval:"none",requiredPermission:ownerGrantablePermission("social.publication.read")},
 tenantScope:SCOPE,availability:{resolver:"paige-capability-status",states:["live","unavailable"]},
 providerBinding:{kind:"internal",operation:"edge.social-publish-command/inspect",connectionResolver:null},idempotency:{mode:"not_applicable"},
 receipt:RECEIPT,outcome:{projector:"capability-record"},
});
export const SOCIAL_PUBLICATION_CHECK_CAPABILITY=defineCapability({
 identity:{id:"social.publication_check",version:1,domain:"social",owner:"solo-campaigns",humanSurface:"/solo/:account/growth/social",
  description:"Read back the original unresolved Social attempt by its exact content/publication IDs. The original door reconciles the same native receipt; it cannot create or resend a post."},
 input:objectInputSchema({properties:{content_id:{type:"string",format:"uuid"},publication_id:{type:"string",format:"uuid"}},required:["content_id","publication_id"]}),
 effect:"read",governance:{actionRiskKey:null,risk:"read_only",approval:"none",requiredPermission:ownerGrantablePermission("social.publication.read")},
 tenantScope:SCOPE,availability:{resolver:"paige-capability-status",states:["live","unavailable"]},
 providerBinding:{kind:"internal",operation:"edge.social-publish-command/reconcile",connectionResolver:null},idempotency:{mode:"not_applicable"},
 receipt:RECEIPT,outcome:{projector:"capability-record"},
});
