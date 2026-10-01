import { defineCapability, objectInputSchema, ownerGrantablePermission } from "../../capability-kit/mod.ts";
import type { SpineCapability } from "../contracts.ts";
export const KNOWLEDGE_READ = {
 key:"knowledge.read",domain:"knowledge",owner:"knowledge-system",humanSurface:"/solo/:account/settings/setup/knowledge-bucket",
 action:{classification:"read",executor:"public.read_tenant_knowledge",chatTool:"knowledge_read",riskPolicyKey:"read_only",approvalAuthority:"none",idempotency:"Read only, bounded active workspace projection."},
 outcome:{kinds:["verified","refused","unverified","completed_unrecorded"],projector:"public.read_tenant_knowledge",railVisibility:"Read only, no mutation receipt."},
 chatBinding:"LIVE",mindBinding:"UNAVAILABLE",sharedPrimitiveChange:"NONE",maturity:"PARTIAL",
} as const satisfies SpineCapability;
export const KNOWLEDGE_UPDATE = {
 key:"knowledge.update",domain:"knowledge",owner:"knowledge-system",humanSurface:"/solo/:account/settings/setup/knowledge-bucket",
 action:{classification:"mutate",executor:"public.update_tenant_knowledge_metadata",chatTool:"knowledge_update",riskPolicyKey:"ordinary",approvalAuthority:"chat-canonical",idempotency:"Exact document revision CAS; never automatically retry uncertain acknowledgement. Existing Chat proposal binds document, revision and normalized metadata patch."},
 outcome:{kinds:["verified","refused","unverified","completed_unrecorded"],projector:"public.read_tenant_knowledge",railVisibility:"Canonical SQL owns operation receipt; completed_unrecorded means change verified but receipt missing. Source objects and Memory are unchanged."},
 chatBinding:"LIVE",mindBinding:"UNAVAILABLE",sharedPrimitiveChange:"SCR-2026-09-30-KNOWLEDGE-OUTCOME",maturity:"PARTIAL",
} as const satisfies SpineCapability;
export const KNOWLEDGE_DELETE = {
 key:"knowledge.delete",domain:"knowledge",owner:"knowledge-system",humanSurface:"/solo/:account/settings/setup/knowledge-bucket",
 action:{classification:"mutate",executor:"public.delete_tenant_knowledge",chatTool:"knowledge_delete",riskPolicyKey:"high",approvalAuthority:"chat-canonical",idempotency:"Exact document revision CAS; never automatically retry uncertain acknowledgement. Existing Chat proposal binds document, revision and normalized metadata patch."},
 outcome:{kinds:["verified","refused","unverified","completed_unrecorded"],projector:"public.read_tenant_knowledge",railVisibility:"Canonical SQL owns operation receipt; completed_unrecorded means change verified but receipt missing. Source objects and Memory are unchanged."},
 chatBinding:"LIVE",mindBinding:"UNAVAILABLE",sharedPrimitiveChange:"SCR-2026-09-30-KNOWLEDGE-OUTCOME",maturity:"PARTIAL",
} as const satisfies SpineCapability;
export const KNOWLEDGE_CAPABILITIES=[KNOWLEDGE_READ,KNOWLEDGE_UPDATE,KNOWLEDGE_DELETE] as const;
export const KNOWLEDGE_TOOLS = [
 {type:"function",function:{name:"knowledge_read",description:"Read canonical Knowledge in the current workspace. List metadata or read one document by exact document_id. Returns current revisions for metadata updates/deletion. Content may be explicitly truncated; a saved record or chunk count does not prove complete indexing or owner-confirmed Memory.",parameters:{type:"object",additionalProperties:false,properties:{document_id:{type:"string",format:"uuid"},limit:{type:"integer",minimum:1,maximum:20},offset:{type:"integer",minimum:0}}}}},
 {type:"function",function:{name:"knowledge_update",description:"Update only title, summary, category or tags of the exact Knowledge document revision just read. Uses existing governed approval. Conflict requires fresh read and a new reviewed proposal. Never retry an uncertain outcome automatically. Does not change content, reindex, share, or create Memory.",parameters:{type:"object",additionalProperties:false,properties:{document_id:{type:"string",format:"uuid"},expected_revision:{type:"integer",minimum:1},patch:{type:"object",additionalProperties:false,minProperties:1,properties:{title:{type:"string",minLength:1,maxLength:300},summary:{type:["string","null"],maxLength:2000},category:{type:["string","null"],maxLength:100},tags:{type:"array",maxItems:20,items:{type:"string",maxLength:60}}}}},required:["document_id","expected_revision","patch"]}}},
 {type:"function",function:{name:"knowledge_delete",description:"Permanently delete the exact Knowledge document revision and its chunks after rendered approval. Read the document first; do not guess its ID or revision. Uploaded source objects remain. A conflict requires fresh read/new approval; uncertain outcomes must be inspected before another proposal. No Memory is deleted.",parameters:{type:"object",additionalProperties:false,properties:{document_id:{type:"string",format:"uuid"},expected_revision:{type:"integer",minimum:1}},required:["document_id","expected_revision"]}}},
];

// Constructor-validated contracts describe the existing runtime seams; they do not
// grant permissions or install another executor. SQL and the Chat gate still decide.
// The schema builder expresses nullable fields with anyOf. Non-empty patches are
// additionally enforced by normalizeKnowledgeArgs and the canonical SQL RPC.
export const KNOWLEDGE_READ_KIT = defineCapability({
 identity:{id:"knowledge.read",version:1,domain:"knowledge",owner:"knowledge-system",humanSurface:"/solo/:account/settings/setup/knowledge-bucket",description:"Canonical Knowledge read through the existing governed Chat and caller-JWT SQL seam.",chatTool:"knowledge_read"},
 input:objectInputSchema({properties:{document_id:{type:"string",format:"uuid"},limit:{type:"integer",minimum:1,maximum:20},offset:{type:"integer",minimum:0}}}),
 effect:"read",
 governance:{actionRiskKey:null,risk:"read_only",approval:"none",requiredPermission:ownerGrantablePermission("knowledge.documents.read")},
 tenantScope:{source:"server",tenantResolver:"current_user_tenant_id",actorResolver:"authenticated_user",revalidateAt:["before_availability","before_execution","before_receipt"]},
 availability:{resolver:"paige-capability-status",states:["live","unavailable"]},
 providerBinding:{kind:"internal",operation:"public.read_tenant_knowledge",connectionResolver:null},
 idempotency:{mode:"not_applicable"},
 receipt:{rail:true,recorder:"record_capability_run",redaction:"tenant_safe",visibility:"owner_internal"},
 outcome:{projector:"capability-record"},
});
export const KNOWLEDGE_UPDATE_KIT = defineCapability({
 identity:{id:"knowledge.update",version:1,domain:"knowledge",owner:"knowledge-system",humanSurface:"/solo/:account/settings/setup/knowledge-bucket",description:"Canonical Knowledge update through the existing governed Chat and caller-JWT SQL seam.",chatTool:null},
 input:objectInputSchema({properties:{document_id:{type:"string",format:"uuid"},expected_revision:{type:"integer",minimum:1},patch:{type:"object",additionalProperties:false,properties:{title:{type:"string",minLength:1,maxLength:300},summary:{anyOf:[{type:"string",maxLength:2000},{type:"null"}]},category:{anyOf:[{type:"string",maxLength:100},{type:"null"}]},tags:{type:"array",maxItems:20,items:{type:"string",maxLength:60}}}}},required:["document_id","expected_revision","patch"]}),
 effect:"mutation",
 governance:{actionRiskKey:"knowledge_update",risk:"ordinary",approval:"confirm",requiredPermission:ownerGrantablePermission("knowledge.documents.update")},
 tenantScope:{source:"server",tenantResolver:"current_user_tenant_id",actorResolver:"authenticated_user",revalidateAt:["before_availability","before_execution","before_receipt"]},
 availability:{resolver:"paige-capability-status",states:["live","unavailable"]},
 providerBinding:{kind:"internal",operation:"public.update_tenant_knowledge_metadata",connectionResolver:null},
 idempotency:{mode:"required",key:"tenant+document+expected_revision+normalized_patch",readback:"public.read_tenant_knowledge",replay:"reconcile_then_return"},
 receipt:{rail:true,recorder:"record_capability_run",redaction:"tenant_safe",visibility:"owner_internal"},
 outcome:{projector:"capability-record"},
});
export const KNOWLEDGE_DELETE_KIT = defineCapability({
 identity:{id:"knowledge.delete",version:1,domain:"knowledge",owner:"knowledge-system",humanSurface:"/solo/:account/settings/setup/knowledge-bucket",description:"Canonical Knowledge delete through the existing governed Chat and caller-JWT SQL seam.",chatTool:null},
 input:objectInputSchema({properties:{document_id:{type:"string",format:"uuid"},expected_revision:{type:"integer",minimum:1}},required:["document_id","expected_revision"]}),
 effect:"mutation",
 governance:{actionRiskKey:"knowledge_delete",risk:"high",approval:"confirm",requiredPermission:ownerGrantablePermission("knowledge.documents.delete")},
 tenantScope:{source:"server",tenantResolver:"current_user_tenant_id",actorResolver:"authenticated_user",revalidateAt:["before_availability","before_execution","before_receipt"]},
 availability:{resolver:"paige-capability-status",states:["live","unavailable"]},
 providerBinding:{kind:"internal",operation:"public.delete_tenant_knowledge",connectionResolver:null},
 idempotency:{mode:"required",key:"tenant+document+expected_revision+normalized_patch",readback:"public.read_tenant_knowledge",replay:"reconcile_then_return"},
 receipt:{rail:true,recorder:"record_capability_run",redaction:"tenant_safe",visibility:"owner_internal"},
 outcome:{projector:"capability-record"},
});
export const KNOWLEDGE_KIT_CAPABILITIES = [KNOWLEDGE_READ_KIT, KNOWLEDGE_UPDATE_KIT, KNOWLEDGE_DELETE_KIT] as const;
